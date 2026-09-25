import { Injectable } from '@nestjs/common';
import { AiGateway } from '../../infrastructure/ai/ai.gateway.js';
import { AiConfig } from '../../config/app-config.js';
import { AiFailureTracker } from '../../domain/ai/ai-failure-tracker.js';
import { extractAiContent } from '../../domain/ai/ai-content.js';
import { formatAddressList } from '../../domain/utils/ai-content-format.js';
import { mapWithConcurrency } from '../../domain/utils/concurrency.js';
import type { MailboxSession } from '../mailbox-session.js';

interface ClassifiableMessage {
  uid: number;
  raw: unknown;
  envelope?: {
    subject?: string;
    from?: Array<{ name?: string; address?: string }>;
    to?: Array<{ name?: string; address?: string }>;
    date?: unknown;
  };
}

interface AiInfo {
  score: number | null;
  reasoning: string | null;
  error: string | null;
}

/**
 * Runs AI classification on rspamd's nonSpam/lowSpam candidate buckets only.
 * Never throws - per-message failures are caught and fail open (no
 * escalation). Ported from terminal's `ai-classification.step.ts`
 * (`classifyWithAi`): `AI_CONCURRENCY`/`AI_MAX_INPUT_TOKENS`/
 * `AI_FAILURE_ALERT_THRESHOLD` come from the injected global `AiConfig`
 * (the AI provider is shared by every mailbox - see design.md D5); the
 * shared `AiFailureTracker` is injected as a singleton per design.md D4,
 * since AI failures are tracked process-wide, not per mailbox.
 *
 * Unlike terminal, this step does not compute or return an
 * `aiFailureAlert` - the alert-email step is a documented non-goal of this
 * change (AI failures become status-only in a later change), so nothing
 * ever consumes it. `AiFailureTracker.recordFailure`/`recordSuccess` are
 * still called on every classification, so the tracker's process-wide
 * streak stays accurate for whatever consumes it next.
 */
@Injectable()
export class AiClassificationStep {
  constructor(
    private readonly ai: AiGateway,
    private readonly aiConfig: AiConfig,
    private readonly aiFailureTracker: AiFailureTracker
  ) {}

  /**
   * Identifying fields for log lines, sourced from the envelope directly
   * (always available, even if content extraction itself fails) rather
   * than from the AI-extracted content - so a UID alone is never the only
   * way to find the email.
   */
  private logIdentity(message: ClassifiableMessage): {
    subject: string;
    from: string;
  } {
    return {
      subject: message.envelope?.subject || '',
      from: formatAddressList(message.envelope?.from),
    };
  }

  /**
   * Classifies a single message with the AI, never throwing - failures are
   * logged and reflected as aiInfo.error so the caller can fail open (no
   * escalation).
   */
  private async classifyOne<M extends ClassifiableMessage>(
    message: M,
    session: MailboxSession
  ): Promise<M & { aiInfo: AiInfo }> {
    const identity = this.logIdentity(message);
    try {
      const content = await extractAiContent(message, {
        maxInputTokens: this.aiConfig.maxInputTokens,
      });
      const { score, reasoning } = await this.ai.classifyEmail(content);
      session.logger.info(
        { uid: message.uid, ...identity, score, reasoning },
        'AI classification completed'
      );
      this.aiFailureTracker.recordSuccess();
      return { ...message, aiInfo: { score, reasoning, error: null } };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      session.logger.error(
        { uid: message.uid, ...identity, error: errorMessage },
        'AI classification failed - message stays in original bucket (fail-open)'
      );
      this.aiFailureTracker.recordFailure(
        err,
        this.aiConfig.failureAlertThreshold
      );
      return {
        ...message,
        aiInfo: { score: null, reasoning: null, error: errorMessage },
      };
    }
  }

  async classify<M extends ClassifiableMessage>(
    {
      nonSpamMessages,
      lowSpamMessages,
    }: { nonSpamMessages: M[]; lowSpamMessages: M[] },
    session: MailboxSession
  ): Promise<{
    nonSpamMessages: (M & { aiInfo: AiInfo })[];
    lowSpamMessages: (M & { aiInfo: AiInfo })[];
  }> {
    const all = [...nonSpamMessages, ...lowSpamMessages];
    if (all.length === 0) {
      return { nonSpamMessages: [], lowSpamMessages: [] };
    }

    const results = await mapWithConcurrency(
      all,
      this.aiConfig.concurrency,
      item => this.classifyOne(item, session)
    );

    session.logger.info(
      {
        total: results.length,
        failed: results.filter(m => m.aiInfo.error).length,
      },
      'AI classification batch completed'
    );

    return {
      nonSpamMessages: results.slice(0, nonSpamMessages.length),
      lowSpamMessages: results.slice(nonSpamMessages.length),
    };
  }
}
