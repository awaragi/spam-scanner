import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { AiConfig } from '../../config/app-config.js';
import { parseAiClassificationOutput } from '../../domain/utils/email-parser.js';

/**
 * Email content to be classified for spam likelihood
 */
export interface AiContent {
  from: string;
  to: string;
  subject: string;
  date: string;
  text: string;
}

/**
 * Gateway for OpenAI-compatible AI classification. Constructs the client
 * from injected config, with no module-level config reads or client
 * instantiation. Each method is called with fresh config field reads.
 */
@Injectable()
export class AiGateway {
  private readonly logger = new Logger(AiGateway.name);
  private client: OpenAI;

  constructor(private readonly aiConfig: AiConfig) {
    this.client = new OpenAI({
      apiKey: aiConfig.apiKey || 'not-needed',
      baseURL: aiConfig.baseUrl,
      timeout: aiConfig.timeoutMs,
      maxRetries: aiConfig.maxRetries,
    });
  }

  /**
   * Builds the static system prompt: safety-net framing, escalation rubric, response
   * format contract. Computed on each call (no cache), so retry logic maintains
   * independent prompts.
   */
  buildSystemPrompt(): string {
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

Respond with ONLY a JSON object, no markdown fences, no extra text:
{"score": <0-100 integer, how confident you are this IS spam>, "reasoning": "<one sentence>"}`;
  }

  /**
   * Builds the per-email user message content. Contains only variable content -
   * never mixed with the static system prompt - with the body text last.
   */
  buildUserContent(content: AiContent): string {
    return `From: ${content.from}
To: ${content.to}
Subject: ${content.subject}
Date: ${content.date}

Body:
${content.text}`;
  }

  /**
   * Classifies an email's spam likelihood via an OpenAI-compatible chat-completions API.
   * @param content Email content to classify
   * @returns Object containing spam score (0-100) and reasoning
   * @throws {Error} on request failure or a malformed AI response
   */
  async classifyEmail(
    content: AiContent
  ): Promise<{ score: number; reasoning: string }> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.aiConfig.model,
        messages: [
          { role: 'system', content: this.buildSystemPrompt() },
          { role: 'user', content: this.buildUserContent(content) },
        ],
        // No custom `temperature`: reasoning-family models (o-series, GPT-5, etc.)
        // only support the default value and reject any override.
        // max_tokens is deprecated and rejected by newer models (o-series, GPT-5, etc.);
        // max_completion_tokens is the current, forward-compatible parameter.
        max_completion_tokens: this.aiConfig.maxOutputTokens,
      });

      const replyContent = response?.choices?.[0]?.message?.content?.trim();
      if (!replyContent) {
        throw new Error('Empty response from AI provider');
      }

      const result = parseAiClassificationOutput(replyContent);
      this.logger.debug(
        { subject: content.subject, from: content.from, score: result.score },
        'AI classification response parsed'
      );
      return result;
    } catch (err) {
      this.logger.error(
        {
          subject: content.subject,
          from: content.from,
          error: err instanceof Error ? err.message : String(err),
        },
        'AI classification request failed'
      );
      throw err;
    }
  }
}
