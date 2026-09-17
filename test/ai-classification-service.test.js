import { describe, test, expect, vi, beforeEach } from 'vitest';

const { messageLoggerMock } = vi.hoisted(() => ({
  messageLoggerMock: { debug: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

vi.mock('../src/lib/utils/config.js', () => ({
  config: {
    AI_CONCURRENCY: 2,
  },
}));

vi.mock('../src/lib/utils/logger.js', () => ({
  rootLogger: {
    forComponent: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
      forMessage: () => messageLoggerMock,
    }),
  },
}));

vi.mock('../src/lib/utils/ai-content.js', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...actual,
    extractAiContent: vi.fn(),
  };
});

vi.mock('../src/lib/clients/ai-client.js', () => ({
  classifyEmail: vi.fn(),
}));

import { classifyWithAi } from '../src/lib/services/ai-classification-service.js';
import { extractAiContent } from '../src/lib/utils/ai-content.js';
import { classifyEmail } from '../src/lib/clients/ai-client.js';

function makeMessage(uid, envelope = {}) {
  return { uid, envelope, raw: `raw-${uid}` };
}

describe('classifyWithAi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    extractAiContent.mockImplementation(async message => ({
      from: 'a@example.com',
      to: 'b@example.com',
      subject: 's',
      date: 'd',
      text: `text-${message.uid}`,
    }));
  });

  test('returns immediately with empty arrays when there are no candidates', async () => {
    const result = await classifyWithAi({
      nonSpamMessages: [],
      lowSpamMessages: [],
    });

    expect(result).toEqual({ nonSpamMessages: [], lowSpamMessages: [] });
    expect(extractAiContent).not.toHaveBeenCalled();
    expect(classifyEmail).not.toHaveBeenCalled();
  });

  test('attaches aiInfo on success and preserves bucket split/order', async () => {
    classifyEmail.mockImplementation(async content => ({
      score: 20,
      reasoning: `reason-${content.text}`,
    }));

    const nonSpamMessages = [makeMessage(1), makeMessage(2)];
    const lowSpamMessages = [makeMessage(3)];

    const result = await classifyWithAi({ nonSpamMessages, lowSpamMessages });

    expect(result.nonSpamMessages).toHaveLength(2);
    expect(result.lowSpamMessages).toHaveLength(1);
    expect(result.nonSpamMessages[0]).toMatchObject({
      uid: 1,
      aiInfo: { score: 20, reasoning: 'reason-text-1', error: null },
    });
    expect(result.nonSpamMessages[1]).toMatchObject({
      uid: 2,
      aiInfo: { score: 20, reasoning: 'reason-text-2', error: null },
    });
    expect(result.lowSpamMessages[0]).toMatchObject({
      uid: 3,
      aiInfo: { score: 20, reasoning: 'reason-text-3', error: null },
    });
  });

  test('fails open on a per-message error without affecting sibling messages or rethrowing', async () => {
    classifyEmail.mockImplementation(async content => {
      if (content.text === 'text-2') {
        throw new Error('provider timeout');
      }
      return { score: 15, reasoning: 'ok' };
    });

    const nonSpamMessages = [makeMessage(1), makeMessage(2), makeMessage(3)];

    const result = await classifyWithAi({
      nonSpamMessages,
      lowSpamMessages: [],
    });

    expect(result.nonSpamMessages[0].aiInfo).toEqual({
      score: 15,
      reasoning: 'ok',
      error: null,
    });
    expect(result.nonSpamMessages[1].aiInfo).toEqual({
      score: null,
      reasoning: null,
      error: 'provider timeout',
    });
    expect(result.nonSpamMessages[2].aiInfo).toEqual({
      score: 15,
      reasoning: 'ok',
      error: null,
    });
  });

  test('fails open when content extraction itself throws', async () => {
    extractAiContent.mockImplementation(async message => {
      if (message.uid === 2) throw new Error('malformed MIME');
      return {
        from: 'a',
        to: 'b',
        subject: 's',
        date: 'd',
        text: `text-${message.uid}`,
      };
    });
    classifyEmail.mockResolvedValue({ score: 5, reasoning: 'ok' });

    const result = await classifyWithAi({
      nonSpamMessages: [makeMessage(1), makeMessage(2)],
      lowSpamMessages: [],
    });

    expect(result.nonSpamMessages[0].aiInfo.error).toBeNull();
    expect(result.nonSpamMessages[1].aiInfo).toEqual({
      score: null,
      reasoning: null,
      error: 'malformed MIME',
    });
  });

  test('respects the configured concurrency cap', async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    classifyEmail.mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(resolve => setTimeout(resolve, 5));
      inFlight--;
      return { score: 1, reasoning: 'ok' };
    });

    const nonSpamMessages = [1, 2, 3, 4, 5].map(uid => makeMessage(uid));

    await classifyWithAi({ nonSpamMessages, lowSpamMessages: [] });

    expect(maxInFlight).toBeLessThanOrEqual(2); // AI_CONCURRENCY mocked to 2
  });

  test('success log line includes subject and from so a UID is not the only identifier', async () => {
    classifyEmail.mockResolvedValue({ score: 42, reasoning: 'borderline' });

    const message = makeMessage(1, {
      subject: 'Your subscription renewal',
      from: [{ name: 'Apple', address: 'no_reply@email.apple.com' }],
    });

    await classifyWithAi({ nonSpamMessages: [message], lowSpamMessages: [] });

    expect(messageLoggerMock.info).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Your subscription renewal',
        from: 'Apple <no_reply@email.apple.com>',
        score: 42,
        reasoning: 'borderline',
      }),
      'AI classification completed'
    );
  });

  test('failure log line includes subject and from even when content extraction itself throws', async () => {
    extractAiContent.mockRejectedValue(new Error('malformed MIME'));

    const message = makeMessage(1, {
      subject: 'Weird encoding',
      from: [{ address: 'sender@example.com' }],
    });

    await classifyWithAi({ nonSpamMessages: [message], lowSpamMessages: [] });

    expect(messageLoggerMock.error).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: 'Weird encoding',
        from: 'sender@example.com',
        error: 'malformed MIME',
      }),
      'AI classification failed - message stays in original bucket (fail-open)'
    );
  });
});
