import { rootLogger } from '../../core/logger.ts';
import { extractAiContent } from '../../services/ai-content.service.ts';
import { classifyEmail } from '../../clients/ai.client.ts';
import { mapWithConcurrency } from '../../utils/concurrency.util.ts';
import { createDefaultContext, type Context } from '../../core/context.ts';

const logger = rootLogger.forComponent('classify-dataset');

interface DatasetMessage {
  bucket: string;
  filename: string;
  uid: string;
  raw: unknown;
  envelope?: {
    subject?: string;
    from?: Array<{ name?: string; address?: string }>;
    to?: Array<{ name?: string; address?: string }>;
    date?: unknown;
  };
}

interface DatasetResult {
  bucket: string;
  filename: string;
  score: number | null;
  reasoning: string | null;
  error: string | null;
}

/**
 * Classifies a single dataset message, never throwing - failures are caught
 * and reflected as `error` so one bad message doesn't abort the batch (same
 * fail-open shape as `ai-classification.step.js`'s `classifyOne`).
 * @param {{bucket: string, filename: string, uid: string, envelope: Object, raw: Buffer}} message
 * @param {Object} ctx
 * @returns {Promise<{bucket: string, filename: string, score: number|null, reasoning: string|null, error: string|null}>}
 */
async function classifyOne(
  message: DatasetMessage,
  ctx: Context
): Promise<DatasetResult> {
  const { bucket, filename } = message;
  try {
    const content = await extractAiContent(message, {
      maxInputTokens: ctx.config.AI_MAX_INPUT_TOKENS,
    });
    const { score, reasoning } = await classifyEmail(content);
    return { bucket, filename, score, reasoning, error: null };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error(
      { bucket, filename, error: errorMessage },
      'Dataset message classification failed'
    );
    return {
      bucket,
      filename,
      score: null,
      reasoning: null,
      error: errorMessage,
    };
  }
}

/**
 * Classifies an entire loaded `.eml` dataset, bounded by `ctx.config.AI_CONCURRENCY`.
 * Never throws - per-message failures are caught and recorded (see `classifyOne`).
 * @param {Array<{bucket: string, filename: string, uid: string, envelope: Object, raw: Buffer}>} messages
 * @param {Object} [ctx]
 * @returns {Promise<Array<{bucket: string, filename: string, score: number|null, reasoning: string|null, error: string|null}>>}
 */
export async function classifyDataset(
  messages: DatasetMessage[],
  ctx: Context = createDefaultContext()
): Promise<DatasetResult[]> {
  if (messages.length === 0) return [];

  const results = await mapWithConcurrency(
    messages,
    ctx.config.AI_CONCURRENCY,
    message => classifyOne(message, ctx)
  );

  logger.info(
    {
      total: results.length,
      failed: results.filter(r => r.error).length,
    },
    'Dataset classification completed'
  );

  return results;
}
