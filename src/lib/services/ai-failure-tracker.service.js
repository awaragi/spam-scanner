import { categorizeAiError } from './ai-error-reason.service.js';

/**
 * The one accepted exception inside `services`: `nextFailureStreak` is pure
 * and 100%-tested, but this module also exports a small stateful
 * `AiFailureTracker` class, one instance of which lives on `ctx`.
 */

function emptyStreak() {
  return {
    reason: null,
    count: 0,
    notified: false,
    lastError: null,
    lastAt: null,
  };
}

/**
 * Computes the next failure streak given a new failure, and whether an alert
 * should now be posted. Does not itself mark the streak as notified - call
 * `AiFailureTracker.markNotified()` only after the alert has actually been
 * delivered, so a delivery failure can retry on the next failure.
 * @param {{reason: string|null, count: number, notified: boolean, lastError: string|null, lastAt: string|null}} streak
 * @param {Error} err
 * @param {number} threshold
 * @param {() => string} [now]
 * @returns {{streak: Object, shouldAlert: boolean}}
 */
export function nextFailureStreak(
  streak,
  err,
  threshold,
  now = () => new Date().toISOString()
) {
  const reason = categorizeAiError(err);
  const lastAt = now();
  const lastError = err?.message || String(err);

  const next =
    streak.reason === reason
      ? { ...streak, count: streak.count + 1 }
      : { reason, count: 1, notified: false, lastError: null, lastAt: null };

  next.lastError = lastError;
  next.lastAt = lastAt;

  const shouldAlert =
    threshold > 0 && next.count >= threshold && !next.notified;

  return { streak: next, shouldAlert };
}

/**
 * Tracks a single active "streak" of consecutive same-reason AI
 * classification failures, for the life of the process (not persisted). A
 * failure with a different reason than the active streak abandons it and
 * starts a new one. A success resets it entirely.
 */
export class AiFailureTracker {
  #streak = emptyStreak();

  /**
   * @param {Error} err
   * @param {number} threshold
   * @returns {{shouldAlert: boolean, reason: string, count: number, lastError: string, lastAt: string}}
   */
  recordFailure(err, threshold) {
    const { streak: next, shouldAlert } = nextFailureStreak(
      this.#streak,
      err,
      threshold
    );
    this.#streak = next;
    return {
      shouldAlert,
      reason: next.reason,
      count: next.count,
      lastError: next.lastError,
      lastAt: next.lastAt,
    };
  }

  recordSuccess() {
    this.#streak = emptyStreak();
  }

  /**
   * @param {string} reason - the `reason` returned alongside `shouldAlert: true`
   */
  markNotified(reason) {
    if (this.#streak.reason === reason) {
      this.#streak = { ...this.#streak, notified: true };
    }
  }
}
