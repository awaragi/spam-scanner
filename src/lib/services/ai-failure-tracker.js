import { config } from '../utils/config.js';
import { categorizeAiError } from '../utils/ai-error-reason.js';

/**
 * Single active "streak" of consecutive same-reason AI classification failures,
 * tracked for the life of the process (not persisted). A failure with a
 * different reason than the active streak abandons it and starts a new one.
 * A success resets it entirely.
 */
let streak = emptyStreak();

function emptyStreak() {
  return { reason: null, count: 0, notified: false, lastError: null, lastAt: null };
}

/**
 * Records an AI classification failure and reports whether an alert should
 * now be posted. Does not itself mark the streak as notified - call
 * `markNotified()` only after the alert has actually been delivered, so a
 * delivery failure can retry on the next failure.
 * @param {Error} err
 * @returns {{shouldAlert: boolean, reason: string, count: number, lastError: string, lastAt: string}}
 */
export function recordFailure(err) {
  const reason = categorizeAiError(err);
  const lastAt = new Date().toISOString();
  const lastError = err?.message || String(err);

  if (streak.reason === reason) {
    streak.count += 1;
  } else {
    streak = { reason, count: 1, notified: false, lastError: null, lastAt: null };
  }
  streak.lastError = lastError;
  streak.lastAt = lastAt;

  const threshold = config.AI_FAILURE_ALERT_THRESHOLD;
  const shouldAlert =
    threshold > 0 && streak.count >= threshold && !streak.notified;

  return { shouldAlert, reason: streak.reason, count: streak.count, lastError: streak.lastError, lastAt: streak.lastAt };
}

/**
 * Records a successful AI classification, resetting the streak so a future
 * recurrence of any failure reason can alert again.
 */
export function recordSuccess() {
  streak = emptyStreak();
}

/**
 * Marks the currently active streak as having successfully alerted, so
 * `recordFailure` stops reporting `shouldAlert` for it. Call this only after
 * the alert message has actually been delivered - if the streak has already
 * moved on (reason changed or was reset) since the alert was decided, this
 * is a no-op.
 * @param {string} reason - the `reason` returned alongside the `shouldAlert: true` result
 */
export function markNotified(reason) {
  if (streak.reason === reason) {
    streak.notified = true;
  }
}
