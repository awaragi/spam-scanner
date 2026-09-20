import { describe, test, expect } from 'vitest';
import { createDefaultContext } from '../../../src/lib/core/context.js';
import { AiFailureTracker } from '../../../src/lib/services/ai-failure-tracker.service.js';
import { config } from '../../../src/lib/core/config.js';

describe('createDefaultContext', () => {
  test('returns the real config singleton and an AiFailureTracker instance', () => {
    const ctx = createDefaultContext();

    expect(ctx.config).toBe(config);
    expect(ctx.aiFailureTracker).toBeInstanceOf(AiFailureTracker);
  });

  test('memoizes: every call returns the exact same object, never a fresh one', () => {
    const first = createDefaultContext();
    const second = createDefaultContext();

    expect(second).toBe(first);
    expect(second.aiFailureTracker).toBe(first.aiFailureTracker);
  });
});
