import { Injectable } from '@nestjs/common';
import { simpleParser } from 'mailparser';
import { RspamdGateway } from '../../infrastructure/rspamd/rspamd.gateway.js';
import { RspamdConfig } from '../../config/app-config.js';
import {
  parseRspamdOutput,
  resolveConnectingHop,
} from '../../domain/utils/email-parser.js';
import { dateToString } from '../../domain/utils/email.js';
import { isPermanentError } from '../../domain/classification/error-classifier.js';
import type { MailboxSession } from '../mailbox-session.js';

interface RspamdEnvelope {
  ip: string | null;
  helo: string | null;
  from: string | null;
  rcpt: string | null;
}

interface RspamdMessage {
  uid: number;
  envelope: { subject?: string; date?: unknown; [key: string]: unknown };
  raw: unknown;
}

interface SpamInfo {
  score: number;
  required: number;
  senderAuthenticated: boolean;
  subject: string | undefined;
  date: string;
}

type ScoredMessage<M> = M & { spamInfo: SpamInfo };

/**
 * Checks messages against Rspamd, attaching spam information to each one.
 * Ported from terminal's `rspamd-check.step.ts` (`processWithRspamd`):
 * `RSPAMD_ENVELOPE_TRUSTED_HOPS` comes from the injected global
 * `RspamdConfig` (Rspamd's connection is shared by every mailbox); the
 * mailbox's own IMAP login (`IMAP_USER`, for the `Rcpt` envelope header)
 * comes from `session.mailbox.imapUser` (see design.md D5's
 * config-injection-vs-session-settings split).
 */
@Injectable()
export class RspamdCheckStep {
  constructor(
    private readonly rspamd: RspamdGateway,
    private readonly rspamdConfig: RspamdConfig
  ) {}

  /**
   * Builds the envelope data (connecting IP/HELO, envelope-from, recipient)
   * Rspamd needs to evaluate SPF and IP-based DNSBL checks against the real
   * sending relay - see the `rspamd-envelope-data` capability. `rcpt` is
   * only sent when the mailbox's IMAP login looks like an address, since it
   * isn't always one (e.g. a bare login on self-hosted Dovecot).
   */
  private async buildEnvelope(
    raw: unknown,
    imapUser: string,
    session: MailboxSession
  ): Promise<RspamdEnvelope> {
    const rcpt = imapUser?.includes('@') ? imapUser : null;

    try {
      const parsed = await simpleParser(raw as string | Buffer, {
        skipHtmlToText: true,
        skipTextToHtml: true,
        skipImageLinks: true,
      });
      // mailparser returns a bare string instead of a 1-element array when a
      // header occurs exactly once - normalize before indexing.
      const receivedHeaders = ([] as string[]).concat(
        (parsed.headers.get('received') as string | string[] | undefined) ||
          []
      );
      const hop = resolveConnectingHop(
        receivedHeaders,
        this.rspamdConfig.envelopeTrustedHops
      );
      const returnPath = parsed.headers.get('return-path') as
        | { value?: Array<{ address?: string }> }
        | undefined;

      return {
        ip: hop?.ip ?? null,
        helo: hop?.helo ?? null,
        from: returnPath?.value?.[0]?.address || null,
        rcpt,
      };
    } catch (err) {
      session.logger.debug(
        { error: err instanceof Error ? err.message : String(err) },
        'Could not resolve Rspamd envelope data from message headers - continuing without it'
      );
      return { ip: null, helo: null, from: null, rcpt };
    }
  }

  /**
   * Process a single message with Rspamd, returning the message with
   * spamInfo attached on success.
   * - A permanent-for-this-message error (e.g. HTTP 4xx, unparsable
   *   response) is logged at warn and resolved as `null` (skip marker) - it
   *   never rejects.
   * - A transient error (network, 5xx, timeout) rejects, so the caller can
   *   fail the whole batch for retry.
   */
  private async processOne<M extends RspamdMessage>(
    message: M,
    session: MailboxSession
  ): Promise<ScoredMessage<M> | null> {
    const { uid, envelope, raw } = message;
    const subject = envelope.subject;
    const date = dateToString(envelope.date);

    session.logger.debug({ uid, date, subject }, 'Starting Rspamd check');

    try {
      const rspamdEnvelope = await this.buildEnvelope(
        raw,
        session.mailbox.imapUser,
        session
      );
      session.logger.debug(
        { uid, ip: rspamdEnvelope.ip, helo: rspamdEnvelope.helo },
        'Checking email with Rspamd'
      );
      const result = await this.rspamd.checkEmail(
        raw as string | Buffer,
        rspamdEnvelope,
        session.mailbox.id
      );

      session.logger.debug(
        {
          uid,
          subject,
          action: (result as { action?: unknown })?.action,
          score: (result as { score?: unknown })?.score,
        },
        'Rspamd check completed'
      );

      const { score, required, senderAuthenticated } =
        parseRspamdOutput(result);

      session.logger.debug(
        { uid, score, required, senderAuthenticated, date, subject },
        'Rspamd scan results'
      );

      return {
        ...message,
        spamInfo: { score, required, senderAuthenticated, subject, date },
      };
    } catch (err) {
      if (isPermanentError(err)) {
        session.logger.warn(
          {
            uid,
            subject,
            error: err instanceof Error ? err.message : String(err),
          },
          'Rspamd check failed permanently for this message - skipping it, batch continues'
        );
        return null;
      }

      session.logger.error(
        { uid, error: err instanceof Error ? err.message : String(err) },
        'Rspamd check process error'
      );
      throw err;
    }
  }

  /**
   * Checks messages with Rspamd. A permanent failure on one message never
   * blocks the rest of the batch; a transient failure fails the whole call
   * so the caller's existing retry-the-batch behavior applies. Whitelist
   * membership is not this step's concern - it only calls rspamd and
   * returns its raw score/required; see `spam-classifier.ts`'s
   * `applyWhitelistAdjustments` for the score adjustment.
   */
  async check<M extends RspamdMessage>(
    messages: M[],
    session: MailboxSession
  ): Promise<ScoredMessage<M>[]> {
    if (messages.length === 0) {
      return [];
    }

    const settled = await Promise.allSettled(
      messages.map(message => this.processOne(message, session))
    );

    const processedMessages: ScoredMessage<M>[] = [];
    const failedUids: number[] = [];

    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        if (result.value !== null) {
          processedMessages.push(result.value);
        }
      } else {
        failedUids.push(messages[index].uid);
      }
    });

    if (failedUids.length > 0) {
      throw new Error(
        `Rspamd check failed transiently for ${failedUids.length} message(s): ${failedUids.join(', ')}`
      );
    }

    session.logger.info(
      { total: processedMessages.length },
      'Messages processed with Rspamd'
    );
    return processedMessages;
  }
}
