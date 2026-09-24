import { rootLogger } from '../core/logger.ts';
import { config } from '../core/config.ts';

const logger = rootLogger.forComponent('rspamd');

const RSPAMD_URL = config.RSPAMD_URL;
const RSPAMD_PASSWORD = config.RSPAMD_PASSWORD;

/**
 * Builds headers for Rspamd HTTP requests. `envelope` fields are only
 * meaningful for `/checkv2` (they let Rspamd evaluate SPF and IP-based
 * DNSBL checks against the real sending relay); learn endpoints don't score,
 * so callers never pass one.
 * @param {{ip?: string, helo?: string, from?: string, rcpt?: string}} [envelope]
 * @returns {Object} - Headers object with optional password and envelope data
 */
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

function buildHeaders(envelope: RspamdEnvelope = {}): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'text/plain',
  };

  if (RSPAMD_PASSWORD) {
    headers['Password'] = RSPAMD_PASSWORD;
  }

  if (envelope.ip) headers['IP'] = envelope.ip;
  if (envelope.helo) headers['Helo'] = envelope.helo;
  if (envelope.from) headers['From'] = envelope.from;
  if (envelope.rcpt) headers['Rcpt'] = envelope.rcpt;

  return headers;
}

function isAlreadyLearned(result: unknown): boolean {
  const rawError = (result as { error?: unknown } | null)?.error;
  const error = typeof rawError === 'string' ? rawError.toLowerCase() : '';
  return error.includes('already learned');
}

async function parseRspamdJson(response: Response): Promise<LearnResult> {
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
 * @param {string|Buffer} emailContent - Raw email content including headers
 * @param {{ip?: string, helo?: string, from?: string, rcpt?: string}} [envelope] -
 *   Envelope data (connecting IP/HELO, envelope-from, recipient) so Rspamd
 *   can evaluate SPF and IP-based DNSBL checks against the real sending
 *   relay - see the `rspamd-envelope-data` capability. Any field may be
 *   omitted; only the ones present are sent.
 * @returns {Promise<Object>} - Parsed JSON response from Rspamd
 * @throws {Error} - If the request fails or Rspamd returns an error
 */
type ClassifiableError = Error & { status?: number };

export async function checkEmail(
  emailContent: string | Buffer | null | undefined,
  envelope: RspamdEnvelope = {}
): Promise<unknown> {
  if (!emailContent) {
    throw new Error('Email content is required');
  }

  try {
    const response = await fetch(`${RSPAMD_URL}/checkv2`, {
      method: 'POST',
      headers: buildHeaders(envelope),
      body: emailContent,
      signal: AbortSignal.timeout(config.RSPAMD_TIMEOUT_MS),
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
    logger.debug({ result }, 'Rspamd check response');
    return result;
  } catch (err) {
    logger.error(
      {
        error: err instanceof Error ? err.message : String(err),
        url: `${RSPAMD_URL}/checkv2`,
      },
      'Rspamd check request failed'
    );
    throw err;
  }
}

/**
 * Trains Rspamd classifier with ham (non-spam) email
 * @param {string|Buffer} emailContent - Raw email content including headers
 * @returns {Promise<Object>} - Parsed JSON response from Rspamd
 * @throws {Error} - If the request fails or Rspamd returns an error
 */
export async function learnHam(
  emailContent: string | Buffer
): Promise<LearnResult> {
  if (!emailContent) {
    throw new Error('Email content is required');
  }

  try {
    const response = await fetch(`${RSPAMD_URL}/learnham`, {
      method: 'POST',
      headers: buildHeaders(),
      body: emailContent,
      signal: AbortSignal.timeout(config.RSPAMD_TIMEOUT_MS),
    });

    if (!response.ok) {
      const error = await response.text();
      let parsed: LearnResult | null;
      try {
        parsed = JSON.parse(error);
      } catch {
        parsed = null;
      }
      if (response.status === 404 && isAlreadyLearned(parsed)) {
        logger.debug(
          { message: parsed?.error },
          'Rspamd learn ham skipped (already learned, 404)'
        );
        return { success: true, message: parsed?.error, alreadyLearned: true };
      }
      throw new Error(
        `Rspamd learn ham failed with status ${response.status}: ${error}`
      );
    }

    const result = await parseRspamdJson(response);
    logger.debug({ result }, 'Rspamd learn ham response');

    if (result.success !== true) {
      if (isAlreadyLearned(result)) {
        logger.debug({ message: result.error }, 'Rspamd learn ham skipped');
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
    logger.error(
      {
        error: err instanceof Error ? err.message : String(err),
        url: `${RSPAMD_URL}/learnham`,
      },
      'Rspamd learn ham request failed'
    );
    throw err;
  }
}

/**
 * Trains Rspamd classifier with spam email
 * @param {string|Buffer} emailContent - Raw email content including headers
 * @returns {Promise<Object>} - Parsed JSON response from Rspamd
 * @throws {Error} - If the request fails or Rspamd returns an error
 */
export async function learnSpam(
  emailContent: string | Buffer
): Promise<LearnResult> {
  if (!emailContent) {
    throw new Error('Email content is required');
  }

  try {
    const response = await fetch(`${RSPAMD_URL}/learnspam`, {
      method: 'POST',
      headers: buildHeaders(),
      body: emailContent,
      signal: AbortSignal.timeout(config.RSPAMD_TIMEOUT_MS),
    });

    if (!response.ok) {
      const error = await response.text();
      let parsed: LearnResult | null;
      try {
        parsed = JSON.parse(error);
      } catch {
        parsed = null;
      }
      if (response.status === 404 && isAlreadyLearned(parsed)) {
        logger.debug(
          { message: parsed?.error },
          'Rspamd learn spam skipped (already learned, 404)'
        );
        return { success: true, message: parsed?.error, alreadyLearned: true };
      }
      throw new Error(
        `Rspamd learn spam failed with status ${response.status}: ${error}`
      );
    }

    const result = await parseRspamdJson(response);
    logger.debug({ result }, 'Rspamd learn spam response');

    if (result.success !== true) {
      if (isAlreadyLearned(result)) {
        logger.debug({ message: result.error }, 'Rspamd learn spam skipped');
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
    logger.error(
      {
        error: err instanceof Error ? err.message : String(err),
        url: `${RSPAMD_URL}/learnspam`,
      },
      'Rspamd learn spam request failed'
    );
    throw err;
  }
}
