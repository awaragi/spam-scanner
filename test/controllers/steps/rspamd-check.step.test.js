import { describe, test, expect, vi, beforeEach } from 'vitest';

const { fakeRspamdClient } = vi.hoisted(() => {
  return { fakeRspamdClient: { checkEmail: vi.fn() } };
});

vi.mock('../../../src/lib/clients/rspamd.client.js', () => fakeRspamdClient);

const { processWithRspamd } = await import(
  '../../../src/lib/controllers/steps/rspamd-check.step.js'
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
    const result = await processWithRspamd([], new Set());
    expect(result).toEqual([]);
    expect(fakeRspamdClient.checkEmail).not.toHaveBeenCalled();
  });

  test('all messages succeed: returns each with spamInfo attached, unchanged shape', async () => {
    const messages = [makeMessage(1), makeMessage(2)];
    fakeRspamdClient.checkEmail.mockResolvedValue({
      score: 1,
      required_score: 15,
    });

    const result = await processWithRspamd(messages, new Set());

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      uid: 1,
      spamInfo: { score: 1, required: 15, isWhitelisted: false },
    });
    expect(result[1]).toMatchObject({
      uid: 2,
      spamInfo: { score: 1, required: 15, isWhitelisted: false },
    });
  });

  test('a whitelisted sender has 20 subtracted from the raw score', async () => {
    const messages = [makeMessage(1, 'trusted@example.com')];
    fakeRspamdClient.checkEmail.mockResolvedValue({
      score: 30,
      required_score: 15,
    });

    const result = await processWithRspamd(
      messages,
      new Set(['trusted@example.com'])
    );

    expect(result[0].spamInfo).toMatchObject({
      score: 10,
      isWhitelisted: true,
    });
  });

  test('a non-whitelisted sender keeps the raw score unchanged', async () => {
    const messages = [makeMessage(1, 'stranger@example.com')];
    fakeRspamdClient.checkEmail.mockResolvedValue({
      score: 30,
      required_score: 15,
    });

    const result = await processWithRspamd(
      messages,
      new Set(['trusted@example.com'])
    );

    expect(result[0].spamInfo).toMatchObject({
      score: 30,
      isWhitelisted: false,
    });
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

    const result = await processWithRspamd(messages, new Set());

    expect(result).toHaveLength(1);
    expect(result[0].uid).toBe(2);
  });

  test('one transient failure: the whole call rejects', async () => {
    const messages = [makeMessage(1)];
    fakeRspamdClient.checkEmail.mockRejectedValue(new Error('network error'));

    await expect(processWithRspamd(messages, new Set())).rejects.toThrow(
      /transiently/
    );
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

    await expect(processWithRspamd(messages, new Set())).rejects.toThrow(
      /transiently/
    );
  });
});
