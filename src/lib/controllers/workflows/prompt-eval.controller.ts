import { rootLogger } from '../../core/logger.ts';
import { createDefaultContext, type Context } from '../../core/context.ts';
import { loadEmlDataset } from '../../clients/eml-dataset.client.ts';
import { writeReport } from '../../clients/report-file.client.ts';
import { classifyDataset } from '../steps/classify-dataset.step.ts';
import { formatPromptEvalReport } from '../../services/prompt-eval-report.service.ts';

const logger = rootLogger.forComponent('prompt-eval-controller');

/**
 * Runs a full ai-prompt-eval pass: loads a labeled `.eml` dataset, classifies
 * it with the current production prompt/config, formats a report, and writes
 * it to a timestamped file. See the `ai-prompt-eval` capability.
 * @param {{bucketPaths: Record<string, string>, reportsDir: string}} options -
 *   `reportsDir` is mandatory (no default): the caller always states where
 *   reports go, per the `ai-prompt-eval` capability's "Report location is a
 *   required argument" requirement.
 * @param {Object} [ctx]
 * @returns {Promise<{reportPath: string, bucketCounts: Record<string, number>}>}
 */
export async function runPromptEval(
  {
    bucketPaths,
    reportsDir,
  }: { bucketPaths: Record<string, string>; reportsDir: string },
  ctx: Context = createDefaultContext()
): Promise<{ reportPath: string; bucketCounts: Record<string, number> }> {
  const { bucketNames, messages } = await loadEmlDataset(bucketPaths);
  logger.info(
    { bucketPaths, buckets: bucketNames, total: messages.length },
    'Dataset loaded'
  );

  const results = await classifyDataset(messages, ctx);

  const generatedAt = new Date();
  const reportText = formatPromptEvalReport({
    bucketNames,
    results,
    config: {
      model: ctx.config.AI_MODEL,
      maxInputTokens: ctx.config.AI_MAX_INPUT_TOKENS,
      maxOutputTokens: ctx.config.AI_MAX_OUTPUT_TOKENS,
      concurrency: ctx.config.AI_CONCURRENCY,
      escalateToLowThreshold: ctx.config.AI_ESCALATE_TO_LOW_THRESHOLD,
      escalateToHighThreshold: ctx.config.AI_ESCALATE_TO_HIGH_THRESHOLD,
    },
    generatedAt,
  });

  const reportPath = await writeReport(reportsDir, reportText, generatedAt);

  const bucketCounts = Object.fromEntries(
    bucketNames.map(bucket => [
      bucket,
      results.filter(r => r.bucket === bucket).length,
    ])
  );

  return { reportPath, bucketCounts };
}
