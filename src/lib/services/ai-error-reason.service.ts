import { APIError } from 'openai';

/**
 * Fixed reason codes for the AI client's own thrown errors (ai-client.js,
 * parseAiClassificationOutput in email-parser.js). Matched by message prefix
 * since these messages interpolate per-response text (raw AI reply, parser
 * detail) that would otherwise make two failures of the same underlying cause
 * look like different reasons.
 */
const APP_ERROR_PREFIXES: Array<[string, string]> = [
  ['Empty response from AI provider', 'empty_response'],
  ['AI response is not valid JSON', 'invalid_json'],
  ['AI response missing numeric "score" field', 'missing_score'],
];

/**
 * Normalizes an AI classification error into a small, stable reason code so
 * that repeated failures of the same underlying cause are recognized as the
 * same reason, even when the raw error text varies between occurrences.
 * @param {Error} err
 * @returns {string} - an `openai` SDK error class name (e.g. 'RateLimitError'),
 *   a fixed app-level code (e.g. 'invalid_json'), or 'unknown'
 */
export function categorizeAiError(err: unknown): string {
  if (err instanceof APIError) {
    return err.constructor.name;
  }

  const message = err instanceof Error ? err.message : '';
  for (const [prefix, code] of APP_ERROR_PREFIXES) {
    if (message.startsWith(prefix)) {
      return code;
    }
  }

  return 'unknown';
}
