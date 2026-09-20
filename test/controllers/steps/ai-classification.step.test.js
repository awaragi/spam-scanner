import { describe, test, expect, vi, beforeEach } from 'vitest';
import { fixtureContext } from '../../support/fixtures.js';

vi.mock('../../../src/lib/clients/ai.client.js', () => ({
  classifyEmail: vi.fn(),
}));

import { classifyWithAi } from '../../../src/lib/controllers/steps/ai-classification.step.js';
import { classifyEmail } from '../../../src/lib/clients/ai.client.js';

function makeMessage(uid, envelope = {}) {
  return { uid, envelope, raw: `raw-${uid}` };
}

describe('classifyWithAi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('returns immediately with empty arrays when there are no candidates', async () => {
    const ctx = fixtureContext();
    const result = await classifyWithAi(
      { nonSpamMessages: [], lowSpamMessages: [] },
      ctx
    );

    expect(result).toEqual({
      nonSpamMessages: [],
      lowSpamMessages: [],
      aiFailureAlert: null,
    });
    expect(classifyEmail).not.toHaveBeenCalled();
  });

  test('attaches aiInfo on success and preserves bucket split/order', async () => {
    classifyEmail.mockImplementation(async content => ({
      score: 20,
      reasoning: `reason-${content.text}`,
    }));
    const ctx = fixtureContext();

    const nonSpamMessages = [makeMessage(1), makeMessage(2)];
    const lowSpamMessages = [makeMessage(3)];

    const result = await classifyWithAi(
      { nonSpamMessages, lowSpamMessages },
      ctx
    );

    expect(result.nonSpamMessages).toHaveLength(2);
    expect(result.lowSpamMessages).toHaveLength(1);
    expect(result.nonSpamMessages[0]).toMatchObject({
      uid: 1,
      aiInfo: { score: 20, error: null },
    });
    expect(result.lowSpamMessages[0]).toMatchObject({
      uid: 3,
      aiInfo: { score: 20, error: null },
    });
  });

  test('fails open on a per-message error without affecting sibling messages or rethrowing', async () => {
    let call = 0;
    classifyEmail.mockImplementation(async () => {
      call++;
      if (call === 2) throw new Error('provider timeout');
      return { score: 15, reasoning: 'ok' };
    });
    const ctx = fixtureContext();

    const nonSpamMessages = [makeMessage(1), makeMessage(2), makeMessage(3)];

    const result = await classifyWithAi(
      { nonSpamMessages, lowSpamMessages: [] },
      ctx
    );

    const errors = result.nonSpamMessages.map(m => m.aiInfo.error);
    expect(errors.filter(Boolean)).toEqual(['provider timeout']);
    expect(errors.filter(e => e === null)).toHaveLength(2);
  });

  test('respects ctx.config.AI_CONCURRENCY', async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    classifyEmail.mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(resolve => setTimeout(resolve, 5));
      inFlight--;
      return { score: 1, reasoning: 'ok' };
    });

    const ctx = fixtureContext({ config: { AI_CONCURRENCY: 2 } });
    const nonSpamMessages = [1, 2, 3, 4, 5].map(uid => makeMessage(uid));

    await classifyWithAi({ nonSpamMessages, lowSpamMessages: [] }, ctx);

    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  test('aiFailureAlert is null when nothing fails', async () => {
    classifyEmail.mockResolvedValue({ score: 5, reasoning: 'ok' });
    const ctx = fixtureContext();

    const result = await classifyWithAi(
      {
        nonSpamMessages: [makeMessage(1), makeMessage(2)],
        lowSpamMessages: [],
      },
      ctx
    );

    expect(result.aiFailureAlert).toBeNull();
  });

  test('aiFailureAlert is null when failures stay below ctx.config.AI_FAILURE_ALERT_THRESHOLD', async () => {
    classifyEmail.mockRejectedValue(new Error('provider timeout'));
    const ctx = fixtureContext({ config: { AI_FAILURE_ALERT_THRESHOLD: 3 } });

    const result = await classifyWithAi(
      {
        nonSpamMessages: [makeMessage(1), makeMessage(2)],
        lowSpamMessages: [],
      },
      ctx
    );

    expect(result.aiFailureAlert).toBeNull();
  });

  test('aiFailureAlert surfaces reason/count/lastError once failures cross the threshold', async () => {
    classifyEmail.mockRejectedValue(new Error('provider timeout'));
    const ctx = fixtureContext({ config: { AI_FAILURE_ALERT_THRESHOLD: 3 } });

    const result = await classifyWithAi(
      {
        nonSpamMessages: [makeMessage(1), makeMessage(2), makeMessage(3)],
        lowSpamMessages: [],
      },
      ctx
    );

    expect(result.aiFailureAlert).toMatchObject({
      reason: 'unknown',
      count: 3,
      lastError: 'provider timeout',
    });
    expect(result.aiFailureAlert.lastAt).toEqual(expect.any(String));
  });

  test('a success resets ctx.aiFailureTracker so a later failure streak starts over', async () => {
    const ctx = fixtureContext({ config: { AI_FAILURE_ALERT_THRESHOLD: 2 } });
    classifyEmail.mockRejectedValueOnce(new Error('boom'));
    classifyEmail.mockResolvedValueOnce({ score: 1, reasoning: 'ok' });
    classifyEmail.mockRejectedValueOnce(new Error('boom'));

    await classifyWithAi(
      { nonSpamMessages: [makeMessage(1)], lowSpamMessages: [] },
      ctx
    );
    await classifyWithAi(
      { nonSpamMessages: [makeMessage(2)], lowSpamMessages: [] },
      ctx
    );
    const third = await classifyWithAi(
      { nonSpamMessages: [makeMessage(3)], lowSpamMessages: [] },
      ctx
    );

    // Threshold is 2, but the success in between reset the streak, so a
    // single subsequent failure must not have crossed it.
    expect(third.aiFailureAlert).toBeNull();
  });

  test('resolves maxInputTokens from ctx.config.AI_MAX_INPUT_TOKENS', async () => {
    classifyEmail.mockResolvedValue({ score: 1, reasoning: 'ok' });
    const ctx = fixtureContext({ config: { AI_MAX_INPUT_TOKENS: 6000 } });
    const message = {
      uid: 1,
      envelope: {},
      raw: `From: a@b.com\r\n\r\n${'x'.repeat(30000)}`,
    };

    await classifyWithAi(
      { nonSpamMessages: [message], lowSpamMessages: [] },
      ctx
    );

    const [content] = classifyEmail.mock.calls[0];
    // 6000 tokens * 4 chars/token = 24000 chars, plus the truncation marker.
    expect(content.text.length).toBeLessThanOrEqual(
      24000 + '…[truncated]'.length
    );
  });
});
