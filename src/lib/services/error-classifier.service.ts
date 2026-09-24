/**
 * Classifies a per-message processing failure as permanent-for-this-message
 * (should be skipped and logged, never retried) vs transient (should fail
 * the whole batch so the orchestrator's existing retry-on-throw behavior
 * applies).
 *
 * An error is permanent when it was explicitly marked as such (e.g. a
 * response-shape parse failure) or carries an HTTP 4xx status. Anything else
 * - including plain network errors that carry neither property - is treated
 * as transient by default, preserving today's "unknown failure fails the
 * batch for retry" behavior.
 * @param {Error} err - The error thrown while processing a single message
 * @returns {boolean} - true if the error is permanent for this message
 */
type ClassifiableError = { permanent?: boolean; status?: number };

export function isPermanentError(err: unknown): boolean {
  if (!err) {
    return false;
  }

  const { permanent, status } = err as ClassifiableError;

  if (permanent === true) {
    return true;
  }

  return typeof status === 'number' && status >= 400 && status < 500;
}
