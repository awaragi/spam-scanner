import { describe, test, expect, vi } from 'vitest';
import { trainMessages, type LearnFn } from './rspamd-training.step.js';

function makeMessage(uid: number) {
  return { uid, envelope: { subject: `subject-${uid}` }, raw: `raw-${uid}` };
}

describe.each([
  ['spam' as const],
  ['ham' as const],
])('trainMessages (%s)', type => {
  test('empty input: returns {learned: [], skipped: []} without calling the learn function', async () => {
    const learnFn: LearnFn = vi.fn();

    const result = await trainMessages([], learnFn, type);

    expect(result).toEqual({ learned: [], skipped: [] });
    expect(learnFn).not.toHaveBeenCalled();
  });

  test('all messages succeed: all returned as learned', async () => {
    const messages = [makeMessage(1), makeMessage(2)];
    const learnFn: LearnFn = vi.fn().mockResolvedValue({ success: true });

    const result = await trainMessages(messages, learnFn, type);

    expect(result.learned).toHaveLength(2);
    expect(result.learned.map(m => m.uid)).toEqual([1, 2]);
  });

  test('one permanent failure, one success: permanent one reported as skipped (not learned), no throw', async () => {
    const messages = [makeMessage(1), makeMessage(2)];
    const learnFn: LearnFn = vi.fn(async raw => {
      if (raw === 'raw-1') {
        const err: Error & { status?: number } = new Error('bad request');
        err.status = 400;
        throw err;
      }
      return { success: true };
    });

    const result = await trainMessages(messages, learnFn, type);

    expect(result.learned).toHaveLength(1);
    expect(result.learned[0].uid).toBe(2);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].uid).toBe(1);
  });

  test('one transient failure: the whole call rejects', async () => {
    const messages = [makeMessage(1)];
    const learnFn: LearnFn = vi.fn().mockRejectedValue(new Error('network error'));

    await expect(trainMessages(messages, learnFn, type)).rejects.toThrow(/transiently/);
  });
});
