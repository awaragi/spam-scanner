/**
 * Utility functions for parsing and processing email content
 */

/**
 * Ad-hoc "permanent vs transient failure" marker set on some thrown errors -
 * see the TypeScript gotchas in convert-to-typescript.tasks.md.
 */
type ClassifiableError = { permanent?: boolean };

interface ReceivedHop {
  ip: string | null;
  helo: string | null;
}

/**
 * Removes all X-Spam-* and X-Ham-Report header lines from email content.
 * @param {string} headerText - Header-only text (no body)
 * @returns {string} - Header text without spam/ham headers
 */
function filterSpamHeaderLines(headerText: string): string {
  const lines = headerText.split('\n');
  const filteredLines: string[] = [];
  let skipNextLines = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lowerLine = line.toLowerCase();

    // Check if this line starts a header we want to remove
    if (
      lowerLine.startsWith('x-spam-') ||
      lowerLine.startsWith('x-ham-report')
    ) {
      skipNextLines = true;
      continue;
    }

    // Check if we're currently skipping lines (continuation of multi-line header)
    if (skipNextLines) {
      // Multi-line headers continue with whitespace (space or tab)
      if (line.startsWith(' ') || line.startsWith('\t')) {
        continue; // Skip this continuation line
      } else {
        // This line doesn't start with whitespace, so the multi-line header has ended
        skipNextLines = false;
        filteredLines.push(line);
      }
    } else {
      filteredLines.push(line);
    }
  }

  return filteredLines.join('\n');
}

/**
 * Removes all X-Spam-* and X-Ham-Report headers from email content. Scans
 * only up to the first blank line (the header/body boundary) so a body line
 * that happens to start with "x-spam-" is never altered.
 * @param {string} emailContent - Raw email content
 * @returns {string} - Email content without spam/ham headers
 */
export function stripSpamHeaders(emailContent: string): string {
  const separatorMatch = emailContent.match(/\r?\n\r?\n/);
  if (!separatorMatch) {
    return filterSpamHeaderLines(emailContent);
  }

  const headerText = emailContent.slice(0, separatorMatch.index);
  const rest = emailContent.slice(separatorMatch.index);
  return filterSpamHeaderLines(headerText) + rest;
}

/**
 * Buffer-safe variant of `stripSpamHeaders`, for message content that isn't
 * known to be valid UTF-8 (e.g. legacy Latin-1/8-bit mail bodies). Decoding
 * the whole buffer as UTF-8 first would replace any invalid byte with U+FFFD
 * before re-encoding, permanently corrupting the body's bytes (which then
 * feeds Bayes tokens and fuzzy hashes at rspamd). `latin1` is a lossless 1:1
 * byte<->code-unit mapping in both directions, so decoding, running the same
 * line-based header stripping, and re-encoding never alters a single body
 * byte - only whole header lines are ever removed.
 * @param {Buffer} messageBuffer - Full raw message (headers + body)
 * @returns {Buffer} - Same bytes, minus any X-Spam- or X-Ham-Report header lines
 */
export function stripSpamHeadersBuffer(messageBuffer: Buffer): Buffer {
  const stripped = stripSpamHeaders(messageBuffer.toString('latin1'));
  return Buffer.from(stripped, 'latin1');
}

const RECEIVED_FROM_RE = /^from\s+(\S+)(?:\s*\(([^)]*)\))?/i;
const IP_IN_BRACKETS_RE = /\[([0-9a-fA-F:.]+)]/;

/**
 * Parses one `Received:` header value for the claimed HELO/EHLO name and the
 * connecting IP address, as written by the MTA that accepted the connection
 * (e.g. `from mail.example.com (unknown [203.0.113.5]) by ...`). Either field
 * may be unavailable depending on the MTA's format.
 * @param {string} value - A single unfolded `Received:` header value
 * @returns {{ip: string|null, helo: string|null}|null} - null if the value
 *   doesn't start with a recognizable `from ...` clause
 */
export function parseReceivedHeader(value: unknown): ReceivedHop | null {
  if (!value || typeof value !== 'string') return null;

  const match = value.replace(/\s+/g, ' ').trim().match(RECEIVED_FROM_RE);
  if (!match) return null;

  const helo = match[1] || null;
  const ipMatch = (match[2] || '').match(IP_IN_BRACKETS_RE);
  const ip = ipMatch ? ipMatch[1] : null;

  if (!ip && !helo) return null;
  return { ip, helo };
}

/**
 * Resolves the IP/HELO of the boundary hop that handed this message to the
 * mailbox provider's own infrastructure, for passing to Rspamd's `IP`/`Helo`
 * request headers so it can evaluate SPF and IP-based DNSBL checks against
 * the real sending relay (see the `rspamd-envelope-data` capability).
 *
 * `Received:` headers are prepended by each hop, so the topmost one is the
 * most recent (closest to final delivery) and the bottommost is the
 * earliest (closest to the original sender). `trustedHops` skips that many
 * headers from the top - internal hops the mailbox provider's own
 * infrastructure added after accepting the message - before reading the
 * boundary hop. Most single-MX setups need `trustedHops: 0`; a setup with an
 * inbound relay in front of the final IMAP store needs a larger value.
 * @param {string[]} receivedHeaders - Raw `Received:` header values, topmost
 *   (most recent) first - e.g. mailparser's `headers.get('received')`,
 *   normalized to an array (it returns a bare string when there's exactly
 *   one occurrence).
 * @param {number} [trustedHops] - Received headers to skip from the top
 * @returns {{ip: string|null, helo: string|null}|null} - null if there's no
 *   `Received:` header at that position, or it couldn't be parsed
 */
export function resolveConnectingHop(
  receivedHeaders: string[] | null | undefined,
  trustedHops = 0
): ReceivedHop | null {
  const boundary = receivedHeaders?.[trustedHops];
  if (!boundary) return null;
  return parseReceivedHeader(boundary);
}

/**
 * Parses raw email content into headers and body.
 * @param {string} rawEmail - Full raw email content (headers + body)
 * @returns {{headers: Record<string, string>, body: string}} - Object containing parsed headers and body
 */
export function parseEmail(rawEmail: string): {
  headers: Record<string, string>;
  body: string;
} {
  const headerEndIndex = rawEmail.search(/\r?\n\r?\n/);
  if (headerEndIndex === -1) return { headers: {}, body: rawEmail };

  const headerText = rawEmail.slice(0, headerEndIndex);
  const body = rawEmail.slice(headerEndIndex + 2).trim();
  const lines = headerText.split(/\r?\n/);
  const headers: Record<string, string> = {};
  let currentKey: string | null = null;

  for (const line of lines) {
    if (/^\s/.test(line) && currentKey) {
      headers[currentKey] += ' ' + line.trim();
    } else {
      const match = line.match(/^([^:]+):\s*(.*)$/);
      if (match) {
        currentKey = match[1].toLowerCase();
        headers[currentKey] = match[2];
      }
    }
  }

  return { headers, body };
}

// Symbols rspamd sets when it verifies the message's own DKIM signature or
// finds a passing DMARC alignment - see rspamd's scores.d/policies_group.conf.
// DMARC_POLICY_ALLOW_WITH_FAILURES deliberately does NOT count: it means the
// policy allowed the message despite a DKIM/SPF failure, not that it verified.
const AUTHENTICATING_SYMBOLS = ['R_DKIM_ALLOW', 'DMARC_POLICY_ALLOW'];

/**
 * Parses Rspamd JSON response to extract its content score. Rspamd is a
 * stateless content scorer only (see the `sender-lists` capability) - it has
 * no list/mailbox awareness, so its own `action` is not used to derive
 * spam/whitelist status. That derivation happens entirely in app code from
 * `score`/`required` plus the app's own whitelist/blacklist lookups (see
 * `spam-classifier.js`). `symbols` IS read for one narrow purpose: whether
 * rspamd found a passing DKIM/DMARC symbol for the message, used to decide
 * whether a whitelist hit can be trusted as authenticated (see the
 * `sender-lists` capability) - this doesn't reintroduce list/mailbox
 * awareness into rspamd, since it's a content-scoring signal rspamd computes
 * for every message regardless of any list.
 * @param {Object} response - JSON response object from Rspamd /checkv2 endpoint
 * @returns {{score: number, required: number, senderAuthenticated: boolean}} - Rspamd's content score, its add-header threshold, and whether it found a passing DKIM/DMARC symbol
 */
export function parseRspamdOutput(response: unknown): {
  score: number;
  required: number;
  senderAuthenticated: boolean;
} {
  if (!response || typeof response !== 'object') {
    const err: Error & ClassifiableError = new Error(
      'Invalid Rspamd response format'
    );
    err.permanent = true;
    throw err;
  }

  const {
    score = 0,
    required_score: required = 0,
    symbols = {},
  } = response as {
    score?: number;
    required_score?: number;
    symbols?: Record<string, unknown>;
  };
  const senderAuthenticated = AUTHENTICATING_SYMBOLS.some(
    symbol => symbol in symbols
  );

  return {
    score,
    required,
    senderAuthenticated,
  };
}

/**
 * Parses an AI chat-completion's text content into a spam classification.
 * Tolerates markdown code fences (```json ... ``` or ``` ... ```) around the JSON.
 * @param {string} content - Raw text content from the AI response
 * @returns {{score: number, reasoning: string}} - Object containing spam classification
 * @throws {Error} - If content is empty, not valid JSON, or missing a numeric score
 */
export function parseAiClassificationOutput(content: unknown): {
  score: number;
  reasoning: string;
} {
  if (!content || typeof content !== 'string') {
    throw new Error('AI response content is empty');
  }

  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = (fenceMatch ? fenceMatch[1] : content).trim();

  let parsed: { score?: unknown; reasoning?: unknown };
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(
      `AI response is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err }
    );
  }

  if (typeof parsed.score !== 'number' || Number.isNaN(parsed.score)) {
    throw new Error(`AI response missing numeric "score" field: ${jsonText}`);
  }

  const score = Math.min(Math.max(parsed.score, 0), 100);
  const reasoning =
    typeof parsed.reasoning === 'string' ? parsed.reasoning.trim() : '';

  return { score, reasoning };
}
