import { simpleParser } from 'mailparser';
import { dateToString } from '../utils/email.js';
import {
  formatAddressList,
  truncateToTokenBudget,
} from '../utils/ai-content-format.js';

interface EnvelopedMessage {
  uid: number | string;
  raw: unknown;
  envelope?: {
    from?: Array<{ name?: string; address?: string }>;
    to?: Array<{ name?: string; address?: string }>;
    subject?: string;
    date?: unknown;
  };
}

/**
 * The extracted, AI-ready shape of one email: what `extractAiContent`
 * produces and `buildUserContent` consumes.
 */
export interface AiContent {
  from: string;
  to: string;
  subject: string;
  date: string;
  text: string;
}

/**
 * Extracts a clean {from, to, subject, date, text} payload for AI classification.
 * from/to/subject/date come from the already MIME-decoded IMAP envelope; text is
 * MIME-aware (multipart-safe, transfer-encoding-decoded) and HTML-stripped via mailparser.
 * Domain policy: the AI input-token budget, resolved by the calling controller
 * from `ctx.config.AI_MAX_INPUT_TOKENS` and passed in as a plain number.
 * @param message - {uid, envelope, raw}
 * @param opts
 */
export async function extractAiContent(
  message: EnvelopedMessage,
  { maxInputTokens }: { maxInputTokens: number },
): Promise<AiContent> {
  const { envelope, raw } = message;

  const parsed = await simpleParser(raw as string | Buffer);
  const text = truncateToTokenBudget(
    (parsed.text || '').trim(),
    maxInputTokens,
  );

  return {
    from: formatAddressList(envelope?.from),
    to: formatAddressList(envelope?.to),
    subject: envelope?.subject || '',
    date: dateToString(envelope?.date),
    text,
  };
}

/**
 * Builds the per-email user message content for AI classification. Contains
 * only variable content - never mixed with the system prompt - with the body
 * text last. Shared between `AiGateway.classifyEmail` (production) and
 * `bin/eval-prompt.ts` (offline prompt evaluation) so both build the exact
 * same request shape against whatever system prompt each supplies.
 */
export function buildUserContent(content: AiContent): string {
  return `From: ${content.from}
To: ${content.to}
Subject: ${content.subject}
Date: ${content.date}

Body:
${content.text}`;
}
