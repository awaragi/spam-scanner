/**
 * Formats an ai-prompt-eval run's classified results into a plain-text report,
 * grouped by bucket with a per-bucket summary. Pure formatting only - no I/O,
 * no domain scoring/target logic (see the `ai-prompt-eval` capability and
 * design.md's Non-Goals: the report presents raw scores, it does not compute
 * a pass/fail verdict).
 */

interface ResultEntry {
  bucket: string;
  filename: string;
  score: number | null;
  reasoning: string | null;
  error: string | null;
}

function formatScoreLine({
  filename,
  score,
  reasoning,
  error,
}: ResultEntry): string {
  if (error) {
    return `${filename}\tERROR\t"${error}"`;
  }
  return `${filename}\tscore=${score}\t"${reasoning}"`;
}

function summarizeBucket(entries: ResultEntry[]): string {
  const scored = entries.filter(e => !e.error);
  if (scored.length === 0) {
    return entries.length === 0
      ? 'summary: (no messages)'
      : 'summary: (no successful classifications)';
  }
  const scores = scored.map(e => e.score as number);
  const avg = scores.reduce((sum, s) => sum + s, 0) / scores.length;
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const failedCount = entries.length - scored.length;
  const failedSuffix = failedCount > 0 ? ` failed=${failedCount}` : '';
  return `summary: count=${scored.length} avg=${avg.toFixed(1)} min=${min} max=${max}${failedSuffix}`;
}

/**
 * @param input
 * @returns plain-text report
 */
interface PromptEvalConfig {
  model: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  concurrency: number;
  escalateToLowThreshold: number;
  escalateToHighThreshold: number;
}

export function formatPromptEvalReport({
  bucketNames,
  results,
  config,
  generatedAt,
}: {
  bucketNames: string[];
  results: ResultEntry[];
  config: PromptEvalConfig;
  generatedAt: Date;
}): string {
  const lines: string[] = [];
  lines.push('AI Prompt Eval Report');
  lines.push(`generated: ${generatedAt.toISOString()}`);
  lines.push(`model: ${config.model}`);
  lines.push(`maxInputTokens: ${config.maxInputTokens}`);
  lines.push(`maxOutputTokens: ${config.maxOutputTokens}`);
  lines.push(`concurrency: ${config.concurrency}`);
  lines.push(`escalateToLowThreshold: ${config.escalateToLowThreshold}`);
  lines.push(`escalateToHighThreshold: ${config.escalateToHighThreshold}`);
  lines.push('');

  for (const bucket of bucketNames) {
    const entries = results.filter(r => r.bucket === bucket);
    lines.push(`== ${bucket} (${entries.length}) ==`);
    for (const entry of entries) {
      lines.push(formatScoreLine(entry));
    }
    lines.push(summarizeBucket(entries));
    lines.push('');
  }

  return lines.join('\n').trimEnd() + '\n';
}
