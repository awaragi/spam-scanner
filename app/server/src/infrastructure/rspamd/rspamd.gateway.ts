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
   * so callers never pass one.
   * @param [envelope]
   * @returns - Headers object with optional password and envelope data
   */
  private buildHeaders(envelope: RspamdEnvelope = {}): Record<string, string> {
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
   * Checks email for spam using Rspamd /checkv2 endpoint
   * @param emailContent - Raw email content including headers
   * @param [envelope] -
   *   Envelope data (connecting IP/HELO, envelope-from, recipient) so Rspamd
   *   can evaluate SPF and IP-based DNSBL checks against the real sending
   *   relay - see the `rspamd-envelope-data` capability. Any field may be
   *   omitted; only the ones present are sent.
   * @returns - Parsed JSON response from Rspamd
   * @throws {Error} - If the request fails or Rspamd returns an error
   */
  async checkEmail(
    emailContent: string | Buffer | null | undefined,
    envelope: RspamdEnvelope = {}
  ): Promise<unknown> {
    if (!emailContent) {
      throw new Error('Email content is required');
    }

    try {
      const response = await fetch(`${this.config.url}/checkv2`, {
        method: 'POST',
        headers: this.buildHeaders(envelope),
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
   * @returns - Parsed JSON response from Rspamd
   * @throws {Error} - If the request fails or Rspamd returns an error
   */
  async learnHam(emailContent: string | Buffer): Promise<LearnResult> {
    if (!emailContent) {
      throw new Error('Email content is required');
    }

    try {
      const response = await fetch(`${this.config.url}/learnham`, {
        method: 'POST',
        headers: this.buildHeaders(),
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
   * @returns - Parsed JSON response from Rspamd
   * @throws {Error} - If the request fails or Rspamd returns an error
   */
  async learnSpam(emailContent: string | Buffer): Promise<LearnResult> {
    if (!emailContent) {
      throw new Error('Email content is required');
    }

    try {
      const response = await fetch(`${this.config.url}/learnspam`, {
        method: 'POST',
        headers: this.buildHeaders(),
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
