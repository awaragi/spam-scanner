import { describe, test, expect, vi, beforeEach } from 'vitest';

const { fakeRspamdClient } = vi.hoisted(() => {
  return { fakeRspamdClient: { checkEmail: vi.fn() } };
});

vi.mock('../../../../src/lib/clients/rspamd.client.js', () => fakeRspamdClient);

const { processWithRspamd } = await import(
  '../../../../src/lib/controllers/steps/rspamd-check.step.js'
);

function makeMessage(uid, from) {
  return {
    uid,
    envelope: {
      subject: `subject-${uid}`,
      date: new Date(),
      ...(from ? { from: [{ address: from }] } : {}),
    },
    raw: `raw-${uid}`,
  };
}

describe('processWithRspamd', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('empty input returns empty array without calling checkEmail', async () => {
    const result = await processWithRspamd([]);
    expect(result).toEqual([]);
    expect(fakeRspamdClient.checkEmail).not.toHaveBeenCalled();
  });

  test('all messages succeed: returns each with spamInfo attached, unchanged shape', async () => {
    const messages = [makeMessage(1), makeMessage(2)];
    fakeRspamdClient.checkEmail.mockResolvedValue({
      score: 1,
      required_score: 15,
    });

    const result = await processWithRspamd(messages);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      uid: 1,
      spamInfo: { score: 1, required: 15 },
    });
    expect(result[1]).toMatchObject({
      uid: 2,
      spamInfo: { score: 1, required: 15 },
    });
    expect(result[0].spamInfo).not.toHaveProperty('isWhitelisted');
  });

  test('threads isSenderAuthenticated from rspamd symbols onto spamInfo', async () => {
    const messages = [makeMessage(1)];
    fakeRspamdClient.checkEmail.mockResolvedValue({
      score: 1,
      required_score: 15,
      symbols: { R_DKIM_ALLOW: { score: -0.2 } },
    });

    const result = await processWithRspamd(messages);

    expect(result[0].spamInfo.isSenderAuthenticated).toBe(true);
  });

  test('one permanent failure, one success: permanent one skipped, success kept, no throw', async () => {
    const messages = [makeMessage(1), makeMessage(2)];
    fakeRspamdClient.checkEmail.mockImplementation(async raw => {
      if (raw === 'raw-1') {
        const err = new Error('bad request');
        err.status = 400;
        throw err;
      }
      return { score: 1, required_score: 15 };
    });

    const result = await processWithRspamd(messages);

    expect(result).toHaveLength(1);
    expect(result[0].uid).toBe(2);
  });

  test('one transient failure: the whole call rejects', async () => {
    const messages = [makeMessage(1)];
    fakeRspamdClient.checkEmail.mockRejectedValue(new Error('network error'));

    await expect(processWithRspamd(messages)).rejects.toThrow(/transiently/);
  });

  test('mixed permanent and transient failures: rejects', async () => {
    const messages = [makeMessage(1), makeMessage(2)];
    fakeRspamdClient.checkEmail.mockImplementation(async raw => {
      if (raw === 'raw-1') {
        const err = new Error('bad request');
        err.status = 400;
        throw err;
      }
      throw new Error('network error');
    });

    await expect(processWithRspamd(messages)).rejects.toThrow(/transiently/);
  });
});
