/**
 * Formats an offline AI-prompt-eval run's classified results into a
 * plain-text report, grouped by bucket with a per-bucket summary. Pure
 * formatting only - no I/O, no scoring/target logic: the report presents raw
 * scores, it does not compute a pass/fail verdict. Used by
 * `bin/eval-prompt.ts`.
 */

export interface PromptEvalResultEntry {
  bucket: string;
  filename: string;
  score: number | null;
  reasoning: string | null;
  error: string | null;
}

export interface PromptEvalConfig {
  promptPath: string;
  model: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  concurrency: number;
  escalateToLowThreshold: number;
  escalateToHighThreshold: number;
}

function formatScoreLine({
  filename,
  score,
  reasoning,
  error,
}: PromptEvalResultEntry): string {
  if (error) {
    return `${filename}\tERROR\t"${error}"`;
  }
  return `${filename}\tscore=${score}\t"${reasoning}"`;
}

function summarizeBucket(entries: PromptEvalResultEntry[]): string {
  const scored = entries.filter((e) => !e.error);
  if (scored.length === 0) {
    return entries.length === 0
      ? 'summary: (no messages)'
      : 'summary: (no successful classifications)';
  }
  const scores = scored.map((e) => e.score as number);
  const avg = scores.reduce((sum, s) => sum + s, 0) / scores.length;
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const failedCount = entries.length - scored.length;
  const failedSuffix = failedCount > 0 ? ` failed=${failedCount}` : '';
  return `summary: count=${scored.length} avg=${avg.toFixed(1)} min=${min} max=${max}${failedSuffix}`;
}

/**
 * Returns the formatted report text alongside each bucket's entry count -
 * the report body already groups `results` by bucket to render it, so this
 * hands that same grouping back to the caller instead of making it re-filter
 * `results` by bucket a second time for its own summary.
 */
export function formatPromptEvalReport({
  bucketNames,
  results,
  config,
  generatedAt,
}: {
  bucketNames: string[];
  results: PromptEvalResultEntry[];
  config: PromptEvalConfig;
  generatedAt: Date;
}): { report: string; bucketCounts: Record<string, number> } {
  const lines: string[] = [];
  lines.push('AI Prompt Eval Report');
  lines.push(`generated: ${generatedAt.toISOString()}`);
  lines.push(`prompt: ${config.promptPath}`);
  lines.push(`model: ${config.model}`);
  lines.push(`maxInputTokens: ${config.maxInputTokens}`);
  lines.push(`maxOutputTokens: ${config.maxOutputTokens}`);
  lines.push(`concurrency: ${config.concurrency}`);
  lines.push(`escalateToLowThreshold: ${config.escalateToLowThreshold}`);
  lines.push(`escalateToHighThreshold: ${config.escalateToHighThreshold}`);
  lines.push('');

  const bucketCounts: Record<string, number> = {};
  for (const bucket of bucketNames) {
    const entries = results.filter((r) => r.bucket === bucket);
    bucketCounts[bucket] = entries.length;
    lines.push(`== ${bucket} (${entries.length}) ==`);
    for (const entry of entries) {
      lines.push(formatScoreLine(entry));
    }
    lines.push(summarizeBucket(entries));
    lines.push('');
  }

  return { report: lines.join('\n').trimEnd() + '\n', bucketCounts };
}
