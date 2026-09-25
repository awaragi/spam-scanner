import { Injectable, Logger } from '@nestjs/common';
import { RspamdConfig } from '../../config/app-config.js';

interface RspamdEnvelope {
  ip?: string | null;
  helo?: string | null;
  from?: string | null;
  rcpt?: string | null;
}

interface LearnResult {
  success: boolean;
  message?: string;
  alreadyLearned?: boolean;
  error?: string;
}

type ClassifiableError = Error & { status?: number };

@Injectable()
export class RspamdGateway {
  private readonly logger = new Logger(RspamdGateway.name);

  constructor(private readonly config: RspamdConfig) {}

  /**
   * Builds headers for Rspamd HTTP requests. `envelope` fields are only
   * meaningful for `/checkv2` (they let Rspamd evaluate SPF and IP-based
   * DNSBL checks against the real sending relay); learn endpoints don't score,
   * so callers never pass one. `user` selects the per-mailbox Bayes model via
   * the `Deliver-To` header (rspamd protocol's per-user selector, `6-per-user-bayes`
   * design D2) - it is only set when non-empty, so a caller that passes none
   * (e.g. terminal) keeps hitting rspamd's default corpus rather than sending
   * an empty header.
   * @param [envelope]
   * @param [user] - Mailbox id to select a per-user Bayes model, if any
   * @returns - Headers object with optional password, envelope data, and user
   */
  private buildHeaders(
    envelope: RspamdEnvelope = {},
    user?: string
  ): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'text/plain',
    };

    if (this.config.password) {
      headers['Password'] = this.config.password;
    }

    if (envelope.ip) headers['IP'] = envelope.ip;
    if (envelope.helo) headers['Helo'] = envelope.helo;
    if (envelope.from) headers['From'] = envelope.from;
    if (envelope.rcpt) headers['Rcpt'] = envelope.rcpt;

    if (user) headers['Deliver-To'] = user;

    return headers;
  }

  /**
   * Checks if a Rspamd response indicates the message was already learned
   * @param result - The parsed response from Rspamd
   * @returns - True if the error message indicates "already learned"
   */
  private isAlreadyLearned(result: unknown): boolean {
    const rawError = (result as { error?: unknown } | null)?.error;
    const error = typeof rawError === 'string' ? rawError.toLowerCase() : '';
    return error.includes('already learned');
  }

  /**
   * Parses JSON response from Rspamd
   * @param response - The Response object from fetch
   * @returns - Parsed LearnResult
   * @throws {Error} - If JSON parsing fails
   */
  private async parseRspamdJson(response: Response): Promise<LearnResult> {
    const text = await response.text();
    if (!text) {
      return { success: true, message: '' };
    }

    try {
      return JSON.parse(text);
    } catch (err) {
      throw new Error(
        `Rspamd response parse failed: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err }
      );
    }
  }

  /**
   * A lightweight best-effort reachability probe against rspamd's `/ping`
   * endpoint - `5-server-api-auth` design.md D8, for `HealthService`'s
   * `rspamd: 'reachable'|'unreachable'` status. Reuses the same base URL,
   * password header, and timeout every other call on this gateway already
   * uses (`buildHeaders`/`this.config`), but - unlike `checkEmail`/
   * `learnHam`/`learnSpam` - never throws: any error (network failure,
   * non-ok response, timeout) resolves `false` rather than propagating, so
   * a health check never fails just because rspamd happens to be down.
   * @returns `true` when rspamd responded successfully, `false` otherwise.
   */
  async ping(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.url}/ping`, {
        method: 'GET',
        headers: this.buildHeaders(),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
      return response.ok;
    } catch (err) {
      this.logger.debug(
        { error: err instanceof Error ? err.message : String(err) },
        'Rspamd ping probe failed',
      );
      return false;
    }
  }

  /**
   * Checks email for spam using Rspamd /checkv2 endpoint
   * @param emailContent - Raw email content including headers
   * @param [envelope] -
   *   Envelope data (connecting IP/HELO, envelope-from, recipient) so Rspamd
   *   can evaluate SPF and IP-based DNSBL checks against the real sending
   *   relay - see the `rspamd-envelope-data` capability. Any field may be
   *   omitted; only the ones present are sent.
   * @param [user] -
   *   Mailbox id to score against that mailbox's own per-user Bayes model
   *   (`6-per-user-bayes`). Omitted entirely (no `Deliver-To` header) when
   *   not given, so the request falls back to rspamd's default model.
   * @returns - Parsed JSON response from Rspamd
   * @throws {Error} - If the request fails or Rspamd returns an error
   */
  async checkEmail(
    emailContent: string | Buffer | null | undefined,
    envelope: RspamdEnvelope = {},
    user?: string
  ): Promise<unknown> {
    if (!emailContent) {
      throw new Error('Email content is required');
    }

    try {
      const response = await fetch(`${this.config.url}/checkv2`, {
        method: 'POST',
        headers: this.buildHeaders(envelope, user),
        body: emailContent as any,
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });

      if (!response.ok) {
        const error = await response.text();
        const err: ClassifiableError = new Error(
          `Rspamd check failed with status ${response.status}: ${error}`
        );
        err.status = response.status;
        throw err;
      }

      const result = await response.json();
      this.logger.debug({ result }, 'Rspamd check response');
      return result;
    } catch (err) {
      this.logger.error(
        {
          error: err instanceof Error ? err.message : String(err),
          url: `${this.config.url}/checkv2`,
        },
        'Rspamd check request failed'
      );
      throw err;
    }
  }

  /**
   * Trains Rspamd classifier with ham (non-spam) email
   * @param emailContent - Raw email content including headers
   * @param [user] -
   *   Mailbox id to train that mailbox's own per-user Bayes model
   *   (`6-per-user-bayes`). Omitted entirely (no `Deliver-To` header) when
   *   not given, so the request falls back to rspamd's default model.
   * @returns - Parsed JSON response from Rspamd
   * @throws {Error} - If the request fails or Rspamd returns an error
   */
  async learnHam(
    emailContent: string | Buffer,
    user?: string
  ): Promise<LearnResult> {
    if (!emailContent) {
      throw new Error('Email content is required');
    }

    try {
      const response = await fetch(`${this.config.url}/learnham`, {
        method: 'POST',
        headers: this.buildHeaders({}, user),
        body: emailContent as any,
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });

      if (!response.ok) {
        const error = await response.text();
        let parsed: LearnResult | null;
        try {
          parsed = JSON.parse(error);
        } catch {
          parsed = null;
        }
        if (response.status === 404 && this.isAlreadyLearned(parsed)) {
          this.logger.debug(
            { message: parsed?.error },
            'Rspamd learn ham skipped (already learned, 404)'
          );
          return { success: true, message: parsed?.error, alreadyLearned: true };
        }
        throw new Error(
          `Rspamd learn ham failed with status ${response.status}: ${error}`
        );
      }

      const result = await this.parseRspamdJson(response);
      this.logger.debug({ result }, 'Rspamd learn ham response');

      if (result.success !== true) {
        if (this.isAlreadyLearned(result)) {
          this.logger.debug(
            { message: result.error },
            'Rspamd learn ham skipped'
          );
          return {
            success: true,
            message: result.error,
            alreadyLearned: true,
          };
        }
        throw new Error(
          `Rspamd learn ham failed: ${JSON.stringify(result) || 'Unknown error'}`
        );
      }

      return result;
    } catch (err) {
      this.logger.error(
        {
          error: err instanceof Error ? err.message : String(err),
          url: `${this.config.url}/learnham`,
        },
        'Rspamd learn ham request failed'
      );
      throw err;
    }
  }

  /**
   * Trains Rspamd classifier with spam email
   * @param emailContent - Raw email content including headers
   * @param [user] -
   *   Mailbox id to train that mailbox's own per-user Bayes model
   *   (`6-per-user-bayes`). Omitted entirely (no `Deliver-To` header) when
   *   not given, so the request falls back to rspamd's default model.
   * @returns - Parsed JSON response from Rspamd
   * @throws {Error} - If the request fails or Rspamd returns an error
   */
  async learnSpam(
    emailContent: string | Buffer,
    user?: string
  ): Promise<LearnResult> {
    if (!emailContent) {
      throw new Error('Email content is required');
    }

    try {
      const response = await fetch(`${this.config.url}/learnspam`, {
        method: 'POST',
        headers: this.buildHeaders({}, user),
        body: emailContent as any,
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });

      if (!response.ok) {
        const error = await response.text();
        let parsed: LearnResult | null;
        try {
          parsed = JSON.parse(error);
        } catch {
          parsed = null;
        }
        if (response.status === 404 && this.isAlreadyLearned(parsed)) {
          this.logger.debug(
            { message: parsed?.error },
            'Rspamd learn spam skipped (already learned, 404)'
          );
          return { success: true, message: parsed?.error, alreadyLearned: true };
        }
        throw new Error(
          `Rspamd learn spam failed with status ${response.status}: ${error}`
        );
      }

      const result = await this.parseRspamdJson(response);
      this.logger.debug({ result }, 'Rspamd learn spam response');

      if (result.success !== true) {
        if (this.isAlreadyLearned(result)) {
          this.logger.debug(
            { message: result.error },
            'Rspamd learn spam skipped'
          );
          return {
            success: true,
            message: result.error,
            alreadyLearned: true,
          };
        }
        throw new Error(
          `Rspamd learn spam failed: ${JSON.stringify(result) || 'Unknown error'}`
        );
      }

      return result;
    } catch (err) {
      this.logger.error(
        {
          error: err instanceof Error ? err.message : String(err),
          url: `${this.config.url}/learnspam`,
        },
        'Rspamd learn spam request failed'
      );
      throw err;
    }
  }
}
