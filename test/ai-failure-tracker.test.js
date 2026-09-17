import { describe, test, expect, vi, beforeEach } from 'vitest';

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: { AI_FAILURE_ALERT_THRESHOLD: 3 },
}));

vi.mock('../src/lib/utils/config.js', () => ({
  config: mockConfig,
}));

import {
  recordFailure,
  recordSuccess,
  markNotified,
} from '../src/lib/services/ai-failure-tracker.js';

function err(message) {
  return new Error(message);
}

describe('ai-failure-tracker', () => {
  beforeEach(() => {
    mockConfig.AI_FAILURE_ALERT_THRESHOLD = 3;
    recordSuccess(); // reset the module-level streak between tests
  });

  test('does not alert below the threshold', () => {
    expect(recordFailure(err('boom')).shouldAlert).toBe(false);
    expect(recordFailure(err('boom')).shouldAlert).toBe(false);
  });

  test('alerts once the threshold is reached, using the default of 3', () => {
    recordFailure(err('boom'));
    recordFailure(err('boom'));
    const result = recordFailure(err('boom'));

    expect(result.shouldAlert).toBe(true);
    expect(result.count).toBe(3);
    expect(result.reason).toBe('unknown');
    expect(result.lastError).toBe('boom');
  });

  test('keeps signaling shouldAlert on further same-reason failures until markNotified is called', () => {
    recordFailure(err('boom'));
    recordFailure(err('boom'));
    expect(recordFailure(err('boom')).shouldAlert).toBe(true);
    // Delivery hasn't been confirmed yet (markNotified not called) - a further
    // failure of the same ongoing issue should still be reported as alert-worthy,
    // so the caller (scan-workflow) can retry a previously failed post.
    expect(recordFailure(err('boom')).shouldAlert).toBe(true);
  });

  test('markNotified suppresses further alerts for the same streak', () => {
    recordFailure(err('boom'));
    recordFailure(err('boom'));
    const { reason } = recordFailure(err('boom'));
    markNotified(reason);

    expect(recordFailure(err('boom')).shouldAlert).toBe(false);
    expect(recordFailure(err('boom')).shouldAlert).toBe(false);
  });

  test('a different failure reason abandons the prior count and starts a new streak at 1', () => {
    recordFailure(err('Empty response from AI provider'));
    recordFailure(err('Empty response from AI provider'));
    // Switch reason right before the old streak would have hit threshold.
    const switched = recordFailure(err('AI response is not valid JSON: bad'));

    expect(switched.reason).toBe('invalid_json');
    expect(switched.count).toBe(1);
    expect(switched.shouldAlert).toBe(false);
  });

  test('a success resets the streak so a later recurrence can alert again', () => {
    recordFailure(err('boom'));
    recordFailure(err('boom'));
    const { reason } = recordFailure(err('boom'));
    markNotified(reason);

    recordSuccess();

    recordFailure(err('boom'));
    recordFailure(err('boom'));
    expect(recordFailure(err('boom')).shouldAlert).toBe(true);
  });

  test('threshold of -1 disables alerting entirely', () => {
    mockConfig.AI_FAILURE_ALERT_THRESHOLD = -1;

    for (let i = 0; i < 10; i++) {
      expect(recordFailure(err('boom')).shouldAlert).toBe(false);
    }
  });

  test('markNotified is a no-op if the streak has already moved on', () => {
    recordFailure(err('boom'));
    recordFailure(err('boom'));
    const { reason } = recordFailure(err('boom'));

    recordSuccess();
    markNotified(reason); // stale reason - streak has already reset

    recordFailure(err('boom'));
    recordFailure(err('boom'));
    expect(recordFailure(err('boom')).shouldAlert).toBe(true);
  });
});
