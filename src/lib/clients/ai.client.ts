import OpenAI from 'openai';
import { rootLogger } from '../core/logger.ts';
import { config } from '../core/config.ts';
import { parseAiClassificationOutput } from '../utils/email-parser.util.ts';

const logger = rootLogger.forComponent('ai-client');

const client = new OpenAI({
  apiKey: config.AI_API_KEY || 'not-needed',
  baseURL: config.AI_BASE_URL,
  timeout: config.AI_TIMEOUT_MS,
  maxRetries: config.AI_MAX_RETRIES,
});

/**
 * Builds the static system prompt: safety-net framing, escalation rubric, response
 * format contract, and optional user profile. Computed once and reused unchanged on
 * every call so it forms a byte-identical, cacheable prefix for providers that
 * support automatic prompt-prefix caching.
 * @returns {string}
 */
export function buildSystemPrompt() {
  const profile = config.AI_USER_PROFILE
    ? `\nMailbox owner context (use to judge relevance/legitimacy): ${config.AI_USER_PROFILE}\n`
    : '';

  return `You are a secondary spam-detection safety net. A spam filter (rspamd) already scored this
email as clean or low-risk. Your job is ONLY to catch cases it may have missed - look for
phishing, scams, unsolicited marketing, or other spam signals it likely under-scored. You are
flagging mail for human review, not making a final spam/not-spam decision.

Weigh the sender's From address as a primary signal, not a minor detail - but judge a domain
that doesn't literally match the claimed brand name in context, not as an automatic red flag:
- NOT suspicious: a subdomain of the brand's own domain (e.g. mail.brand.com), or a
  recognizable third-party bulk-email/ESP relay sending on the brand's behalf (e.g. a
  VERP-style return path, "mail."/"e."/"links." subdomains of an email-platform domain) -
  this is standard marketing infrastructure, not impersonation.
- Suspicious: an address hosted on a generic personal/consumer mail provider (gmail.com,
  icloud.com, outlook.com, etc.) that has a *different* brand or person's name embedded in
  it to impersonate them, or a domain with no discernible relation to the claimed brand and
  no ESP-style pattern. This is a strong phishing/spam indicator even when the message body
  otherwise looks routine or polished.

Marketing mail whose sender is not suspicious by the above, and that has a working
unsubscribe mechanism, is ordinary subscribed marketing - score it low even if it uses
urgency or incentive language ("limited time", "last chance", promotional offers). Reserve
higher scores for promotional mail that also shows other spam signals: a suspicious sender
as described above, shortened/obfuscated links, or content unrelated to the sender's claimed
brand.
${profile}
Respond with ONLY a JSON object, no markdown fences, no extra text:
{"score": <0-100 integer, how confident you are this IS spam>, "reasoning": "<one sentence>"}`;
}

const SYSTEM_PROMPT = buildSystemPrompt();

/**
 * Builds the per-email user message content. Contains only variable content -
 * never mixed with the static system prompt - with the body text last.
 * @param {{from: string, to: string, subject: string, date: string, text: string}} content
 * @returns {string}
 */
export function buildUserContent(content) {
  return `From: ${content.from}
To: ${content.to}
Subject: ${content.subject}
Date: ${content.date}

Body:
${content.text}`;
}

/**
 * Classifies an email's spam likelihood via an OpenAI-compatible chat-completions API.
 * @param {{from: string, to: string, subject: string, date: string, text: string}} content
 * @returns {Promise<{score: number, reasoning: string}>}
 * @throws {Error} on request failure or a malformed AI response
 */
export async function classifyEmail(content) {
  try {
    const response = await client.chat.completions.create({
      model: config.AI_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserContent(content) },
      ],
      // No custom `temperature`: reasoning-family models (o-series, GPT-5, etc.)
      // only support the default value and reject any override.
      // max_tokens is deprecated and rejected by newer models (o-series, GPT-5, etc.);
      // max_completion_tokens is the current, forward-compatible parameter.
      max_completion_tokens: config.AI_MAX_OUTPUT_TOKENS,
    });

    const replyContent = response?.choices?.[0]?.message?.content?.trim();
    if (!replyContent) {
      throw new Error('Empty response from AI provider');
    }

    const result = parseAiClassificationOutput(replyContent);
    logger.debug(
      { subject: content.subject, from: content.from, score: result.score },
      'AI classification response parsed'
    );
    return result;
  } catch (err) {
    logger.error(
      { subject: content.subject, from: content.from, error: err.message },
      'AI classification request failed'
    );
    throw err;
  }
}
