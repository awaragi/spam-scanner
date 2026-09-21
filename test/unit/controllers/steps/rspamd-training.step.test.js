import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../src/lib/clients/rspamd.client.js', () => ({
  learnSpam: vi.fn(),
  learnHam: vi.fn(),
}));

import {
  trainSpam,
  trainHam,
} from '../../../../src/lib/controllers/steps/rspamd-training.step.js';
import {
  learnSpam,
  learnHam,
} from '../../../../src/lib/clients/rspamd.client.js';

function makeMessage(uid) {
  return { uid, envelope: { subject: `subject-${uid}` }, raw: `raw-${uid}` };
}

describe.each([
  ['trainSpam', () => trainSpam, learnSpam],
  ['trainHam', () => trainHam, learnHam],
])('%s', (name, getFn, learnMock) => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('empty input: returns {learned: [], skipped: []} without calling the learn function', async () => {
    const result = await getFn()([]);
    expect(result).toEqual({ learned: [], skipped: [] });
    expect(learnMock).not.toHaveBeenCalled();
  });

  test('all messages succeed: all returned as learned', async () => {
    const messages = [makeMessage(1), makeMessage(2)];
    learnMock.mockResolvedValue({ success: true });

    const result = await getFn()(messages);

    expect(result.learned).toHaveLength(2);
    expect(result.learned.map(m => m.uid)).toEqual([1, 2]);
  });

  test('one permanent failure, one success: permanent one reported as skipped (not learned), no throw', async () => {
    const messages = [makeMessage(1), makeMessage(2)];
    learnMock.mockImplementation(async raw => {
      if (raw === 'raw-1') {
        const err = new Error('bad request');
        err.status = 400;
        throw err;
      }
      return { success: true };
    });

    const result = await getFn()(messages);

    expect(result.learned).toHaveLength(1);
    expect(result.learned[0].uid).toBe(2);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].uid).toBe(1);
  });

  test('one transient failure: the whole call rejects', async () => {
    const messages = [makeMessage(1)];
    learnMock.mockRejectedValue(new Error('network error'));

    await expect(getFn()(messages)).rejects.toThrow(/transiently/);
  });
});
