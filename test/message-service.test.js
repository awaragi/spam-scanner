import { describe, test, expect, vi, beforeEach } from 'vitest';

const { warn, error } = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('../src/lib/utils/logger.js', () => ({
  rootLogger: {
    forComponent: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn,
      error,
      forMessage: () => ({
        debug: vi.fn(),
        info: vi.fn(),
        warn,
        error,
      }),
    }),
  },
}));

vi.mock('../src/lib/clients/rspamd-client.js', () => ({
  checkEmail: vi.fn(),
}));

vi.mock('../src/lib/utils/email-parser.js', () => ({
  parseRspamdOutput: vi.fn(),
}));

vi.mock('../src/lib/utils/email.js', () => ({
  dateToString: vi.fn(() => '2026-01-01'),
}));

import { processWithRspamd } from '../src/lib/services/message-service.js';
import { checkEmail } from '../src/lib/clients/rspamd-client.js';
import { parseRspamdOutput } from '../src/lib/utils/email-parser.js';

function makeMessage(uid) {
  return {
    uid,
    envelope: { subject: `subject-${uid}`, date: new Date() },
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
    expect(checkEmail).not.toHaveBeenCalled();
  });

  test('all messages succeed: returns each with spamInfo attached, unchanged shape', async () => {
    const messages = [makeMessage(1), makeMessage(2)];
    checkEmail.mockResolvedValue({ action: 'no action', score: 1 });
    parseRspamdOutput.mockReturnValue({
      score: 1,
      required: 15,
      level: null,
      isSpam: false,
      isWhitelisted: false,
    });

    const result = await processWithRspamd(messages);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ uid: 1, spamInfo: { isSpam: false } });
    expect(result[1]).toMatchObject({ uid: 2, spamInfo: { isSpam: false } });
  });

  test('one permanent failure, one success: permanent one skipped and logged, success kept, no throw', async () => {
    const messages = [makeMessage(1), makeMessage(2)];
    checkEmail.mockImplementation(async raw => {
      if (raw === 'raw-1') {
        const err = new Error('bad request');
        err.status = 400;
        throw err;
      }
      return { action: 'no action', score: 1 };
    });
    parseRspamdOutput.mockReturnValue({
      score: 1,
      required: 15,
      level: null,
      isSpam: false,
      isWhitelisted: false,
    });

    const result = await processWithRspamd(messages);

    expect(result).toHaveLength(1);
    expect(result[0].uid).toBe(2);
    expect(warn).toHaveBeenCalled();
  });

  test('one transient failure: the whole call rejects', async () => {
    const messages = [makeMessage(1)];
    checkEmail.mockRejectedValue(new Error('network error'));

    await expect(processWithRspamd(messages)).rejects.toThrow(/transiently/);
  });

  test('mixed permanent and transient failures: rejects, but the permanent one is still logged at warn first', async () => {
    const messages = [makeMessage(1), makeMessage(2)];
    checkEmail.mockImplementation(async raw => {
      if (raw === 'raw-1') {
        const err = new Error('bad request');
        err.status = 400;
        throw err;
      }
      throw new Error('network error');
    });

    await expect(processWithRspamd(messages)).rejects.toThrow(/transiently/);
    expect(warn).toHaveBeenCalled();
  });
});
