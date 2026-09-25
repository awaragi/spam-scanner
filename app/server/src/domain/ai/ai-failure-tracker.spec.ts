import { describe, test, expect, beforeEach } from 'vitest';
import {
  nextFailureStreak,
  AiFailureTracker,
  type FailureStreak,
} from './ai-failure-tracker.js';

function err(message: string) {
  return new Error(message);
}

describe('nextFailureStreak', () => {
  const emptyStreak: FailureStreak = {
    reason: null,
    count: 0,
    notified: false,
    lastError: null,
    lastAt: null,
  };

  test('starts a new streak at count 1', () => {
    const { streak, shouldAlert } = nextFailureStreak(
      emptyStreak,
      err('boom'),
      3
    );
    expect(streak).toMatchObject({
      reason: 'unknown',
      count: 1,
      lastError: 'boom',
    });
    expect(shouldAlert).toBe(false);
  });

  test('increments an existing same-reason streak', () => {
    const { streak: first } = nextFailureStreak(emptyStreak, err('boom'), 3);
    const { streak: second } = nextFailureStreak(first, err('boom'), 3);
    expect(second.count).toBe(2);
  });

  test('a different failure reason abandons the prior count and starts at 1', () => {
    const { streak: first } = nextFailureStreak(
      emptyStreak,
      err('Empty response from AI provider'),
      3
    );
    const { streak: second } = nextFailureStreak(
      first,
      err('AI response is not valid JSON: bad'),
      3
    );
    expect(second.reason).toBe('invalid_json');
    expect(second.count).toBe(1);
  });

  test('shouldAlert becomes true once count reaches the threshold and stays true until notified', () => {
    let streak = emptyStreak;
    ({ streak } = nextFailureStreak(streak, err('boom'), 3));
    ({ streak } = nextFailureStreak(streak, err('boom'), 3));
    const third = nextFailureStreak(streak, err('boom'), 3);

    expect(third.shouldAlert).toBe(true);
    expect(third.streak.count).toBe(3);
  });

  test('shouldAlert is false once notified is true', () => {
    const notifiedStreak = {
      reason: 'unknown',
      count: 5,
      notified: true,
      lastError: 'x',
      lastAt: 'y',
    };
    const { shouldAlert } = nextFailureStreak(notifiedStreak, err('boom'), 3);
    expect(shouldAlert).toBe(false);
  });

  test('threshold of -1 disables alerting entirely', () => {
    let streak = emptyStreak;
    let shouldAlert;
    for (let i = 0; i < 10; i++) {
      ({ streak, shouldAlert } = nextFailureStreak(streak, err('boom'), -1));
      expect(shouldAlert).toBe(false);
    }
  });
});

describe('AiFailureTracker', () => {
  let tracker: AiFailureTracker;

  beforeEach(() => {
    tracker = new AiFailureTracker();
  });

  test('does not alert below the threshold', () => {
    expect(tracker.recordFailure(err('boom'), 3).shouldAlert).toBe(false);
    expect(tracker.recordFailure(err('boom'), 3).shouldAlert).toBe(false);
  });

  test('alerts once the threshold is reached', () => {
    tracker.recordFailure(err('boom'), 3);
    tracker.recordFailure(err('boom'), 3);
    const result = tracker.recordFailure(err('boom'), 3);

    expect(result.shouldAlert).toBe(true);
    expect(result.count).toBe(3);
    expect(result.reason).toBe('unknown');
    expect(result.lastError).toBe('boom');
    // Return shape matches the real recordFailure exactly - no `notified` field.
    expect(result).not.toHaveProperty('notified');
  });

  test('keeps signaling shouldAlert on further same-reason failures until markNotified is called', () => {
    tracker.recordFailure(err('boom'), 3);
    tracker.recordFailure(err('boom'), 3);
    expect(tracker.recordFailure(err('boom'), 3).shouldAlert).toBe(true);
    expect(tracker.recordFailure(err('boom'), 3).shouldAlert).toBe(true);
  });

  test('markNotified suppresses further alerts for the same streak', () => {
    tracker.recordFailure(err('boom'), 3);
    tracker.recordFailure(err('boom'), 3);
    const { reason } = tracker.recordFailure(err('boom'), 3);
    tracker.markNotified(reason);

    expect(tracker.recordFailure(err('boom'), 3).shouldAlert).toBe(false);
  });

  test('a success resets the streak so a later recurrence can alert again', () => {
    tracker.recordFailure(err('boom'), 3);
    tracker.recordFailure(err('boom'), 3);
    const { reason } = tracker.recordFailure(err('boom'), 3);
    tracker.markNotified(reason);

    tracker.recordSuccess();

    tracker.recordFailure(err('boom'), 3);
    tracker.recordFailure(err('boom'), 3);
    expect(tracker.recordFailure(err('boom'), 3).shouldAlert).toBe(true);
  });

  test('markNotified is a no-op if the streak has already moved on', () => {
    tracker.recordFailure(err('boom'), 3);
    tracker.recordFailure(err('boom'), 3);
    const { reason } = tracker.recordFailure(err('boom'), 3);

    tracker.recordSuccess();
    tracker.markNotified(reason); // stale reason - streak has already reset

    tracker.recordFailure(err('boom'), 3);
    tracker.recordFailure(err('boom'), 3);
    expect(tracker.recordFailure(err('boom'), 3).shouldAlert).toBe(true);
  });

  test('each tracker instance is independent - no shared state', () => {
    const other = new AiFailureTracker();
    tracker.recordFailure(err('boom'), 3);
    tracker.recordFailure(err('boom'), 3);
    expect(tracker.recordFailure(err('boom'), 3).shouldAlert).toBe(true);
    expect(other.recordFailure(err('boom'), 3).shouldAlert).toBe(false);
  });

  test('status() returns empty state on fresh tracker', () => {
    expect(tracker.status()).toEqual({
      reason: null,
      count: 0,
      lastError: null,
      lastAt: null,
    });
  });

  test('status() reflects the current failure after recordFailure', () => {
    tracker.recordFailure(err('boom'), 3);
    const status = tracker.status();
    expect(status).toMatchObject({
      reason: 'unknown',
      count: 1,
      lastError: 'boom',
    });
    expect(status.lastAt).toBeTruthy();
  });

  test('status() returns to empty state after recordSuccess', () => {
    tracker.recordFailure(err('boom'), 3);
    tracker.recordSuccess();
    expect(tracker.status()).toEqual({
      reason: null,
      count: 0,
      lastError: null,
      lastAt: null,
    });
  });
});
