import { simpleParser } from 'mailparser';
import { rootLogger } from '../../core/logger.ts';
import { checkEmail } from '../../clients/rspamd.client.ts';
import {
  parseRspamdOutput,
  resolveConnectingHop,
} from '../../utils/email-parser.util.ts';
import { dateToString } from '../../utils/email.util.ts';
import { isPermanentError } from '../../services/error-classifier.service.ts';
import { createDefaultContext } from '../../core/context.ts';

const logger = rootLogger.forComponent('rspamd-check');

/**
 * Builds the envelope data (connecting IP/HELO, envelope-from, recipient)
 * Rspamd needs to evaluate SPF and IP-based DNSBL checks against the real
 * sending relay - see the `rspamd-envelope-data` capability. `rcpt` is only
 * sent when `IMAP_USER` looks like an address, since it isn't always one
 * (e.g. a bare login on self-hosted Dovecot). Header parsing goes through
 * `mailparser` (already a dependency) rather than hand-rolled header
 * splitting, since it already handles repeated headers (`Received:`) and
 * `Return-Path:` address parsing correctly - a failure here never blocks
 * the Rspamd check itself, it just means less envelope data is sent.
 * @param {string|Buffer} raw - Raw email content
 * @param {Object} cfg - `ctx.config`
 * @param {Object} messageLogger
 * @returns {Promise<{ip: string|null, helo: string|null, from: string|null, rcpt: string|null}>}
 */
async function buildEnvelope(raw, cfg, messageLogger) {
  const rcpt = cfg.IMAP_USER?.includes('@') ? cfg.IMAP_USER : null;

  try {
    const parsed = await simpleParser(raw, {
      skipHtmlToText: true,
      skipTextToHtml: true,
      skipImageLinks: true,
    });
    // mailparser returns a bare string instead of a 1-element array when a
    // header occurs exactly once - normalize before indexing.
    const receivedHeaders = [].concat(parsed.headers.get('received') || []);
    const hop = resolveConnectingHop(
      receivedHeaders,
      cfg.RSPAMD_ENVELOPE_TRUSTED_HOPS
    );
    const returnPath = parsed.headers.get('return-path');

    return {
      ip: hop?.ip ?? null,
      helo: hop?.helo ?? null,
      from: returnPath?.value?.[0]?.address || null,
      rcpt,
    };
  } catch (err) {
    messageLogger.debug(
      { error: err.message },
      'Could not resolve Rspamd envelope data from message headers - continuing without it'
    );
    return { ip: null, helo: null, from: null, rcpt };
  }
}

/**
 * Process a single message with Rspamd, returning the message with spamInfo
 * attached on success.
 * - A permanent-for-this-message error (e.g. HTTP 4xx, unparsable response)
 *   is logged at warn and resolved as `null` (skip marker) - it never rejects.
 * - A transient error (network, 5xx, timeout) rejects, so the caller can fail
 *   the whole batch for retry.
 */
async function processOneMessage(message, cfg) {
  const { uid, envelope, raw } = message;
  const messageLogger = logger.forMessage(uid);
  const subject = envelope.subject;
  const date = dateToString(envelope.date);

  messageLogger.debug({ date, subject }, 'Starting Rspamd check');

  try {
    const rspamdEnvelope = await buildEnvelope(raw, cfg, messageLogger);
    messageLogger.debug(
      { ip: rspamdEnvelope.ip, helo: rspamdEnvelope.helo },
      'Checking email with Rspamd'
    );
    const result = await checkEmail(raw, rspamdEnvelope);

    messageLogger.debug(
      { subject, action: result.action, score: result.score },
      'Rspamd check completed'
    );

    const { score, required, senderAuthenticated } = parseRspamdOutput(result);

    messageLogger.debug(
      { score, required, senderAuthenticated, date, subject },
      'Rspamd scan results'
    );

    // Return message with spam information attached
    return {
      ...message,
      spamInfo: {
        score,
        required,
        senderAuthenticated,
        subject,
        date,
      },
    };
  } catch (err) {
    if (isPermanentError(err)) {
      messageLogger.warn(
        { subject, error: err.message },
        'Rspamd check failed permanently for this message - skipping it, batch continues'
      );
      return null;
    }

    messageLogger.error({ error: err.message }, 'Rspamd check process error');
    throw err;
  }
}

/**
 * Process messages with Rspamd spam checking. Attaches spam information to
 * each message. A permanent failure on one message never blocks the rest of
 * the batch; a transient failure fails the whole call so the caller's
 * existing retry-the-batch behavior applies. Whitelist membership is not
 * this step's concern - it only calls rspamd and returns its raw
 * score/required; see `spam-classifier.service.js`'s `applyWhitelistAdjustments`
 * for the score adjustment.
 * @param {Array} messages - Array of message objects with uid, envelope, raw
 * @param {Object} [ctx]
 * @returns {Promise<Array>} - Array of messages with spamInfo attached
 */
export async function processWithRspamd(
  messages,
  ctx = createDefaultContext()
) {
  if (messages.length === 0) {
    return [];
  }

  const settled = await Promise.allSettled(
    messages.map(message => processOneMessage(message, ctx.config))
  );

  const processedMessages = [];
  const failedUids = [];

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

  logger.info(
    { total: processedMessages.length },
    'Messages processed with Rspamd'
  );
  return processedMessages;
}
