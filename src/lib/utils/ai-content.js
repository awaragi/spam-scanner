/**
 * Extracts clean, AI-ready content from a fetched message.
 */
import { simpleParser } from 'mailparser';
import { config } from './config.js';
import { dateToString } from './email.js';
import { rootLogger } from './logger.js';

const logger = rootLogger.forComponent('ai-content');

// Rough, dependency-free heuristic for English text; used only to bound cost, not for exact billing.
const CHARS_PER_TOKEN = 4;

/**
 * Formats an ImapFlow envelope address list as "Name <addr>, Name2 <addr2>".
 * @param {Array<{name?: string, address?: string}>} [addresses]
 * @returns {string}
 */
export function formatAddressList(addresses = []) {
  if (!Array.isArray(addresses)) return '';
  return addresses
    .map(({ name, address }) => (name ? `${name} <${address}>` : address))
    .filter(Boolean)
    .join(', ');
}

/**
 * Truncates text to a token budget using a chars-per-token heuristic.
 * @param {string} text
 * @param {number} maxTokens
 * @returns {string}
 */
function truncateToTokenBudget(text, maxTokens) {
  if (!text) return '';
  const maxChars = Math.max(0, maxTokens) * CHARS_PER_TOKEN;
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}…[truncated]`;
}

/**
 * Extracts a clean {from, to, subject, date, text} payload for AI classification.
 * from/to/subject/date come from the already MIME-decoded IMAP envelope; text is
 * MIME-aware (multipart-safe, transfer-encoding-decoded) and HTML-stripped via mailparser.
 * @param {Object} message - {uid, envelope, raw}
 * @param {Object} [opts]
 * @param {number} [opts.maxInputTokens]
 * @returns {Promise<{from: string, to: string, subject: string, date: string, text: string}>}
 */
export async function extractAiContent(message, opts = {}) {
  const maxInputTokens = opts.maxInputTokens ?? config.AI_MAX_INPUT_TOKENS;
  const { envelope, raw, uid } = message;
  const messageLogger = logger.forMessage(uid);

  const parsed = await simpleParser(raw);
  const text = truncateToTokenBudget(
    (parsed.text || '').trim(),
    maxInputTokens
  );

  messageLogger.debug(
    { textLength: text.length, hasHtml: !!parsed.html },
    'Extracted AI content'
  );

  return {
    from: formatAddressList(envelope?.from),
    to: formatAddressList(envelope?.to),
    subject: envelope?.subject || '',
    date: dateToString(envelope?.date),
    text,
  };
}
