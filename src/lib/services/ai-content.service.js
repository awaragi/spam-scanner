import { simpleParser } from 'mailparser';
import { dateToString } from '../utils/email.util.js';
import {
  formatAddressList,
  truncateToTokenBudget,
} from '../utils/ai-content.util.js';
import { rootLogger } from '../utils/logger.js';

const logger = rootLogger.forComponent('ai-content');

/**
 * Extracts a clean {from, to, subject, date, text} payload for AI classification.
 * from/to/subject/date come from the already MIME-decoded IMAP envelope; text is
 * MIME-aware (multipart-safe, transfer-encoding-decoded) and HTML-stripped via mailparser.
 * Domain policy: the AI input-token budget, resolved by the calling controller
 * from `ctx.config.AI_MAX_INPUT_TOKENS` and passed in as a plain number.
 * @param {Object} message - {uid, envelope, raw}
 * @param {{maxInputTokens: number}} opts
 * @returns {Promise<{from: string, to: string, subject: string, date: string, text: string}>}
 */
export async function extractAiContent(message, { maxInputTokens }) {
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
