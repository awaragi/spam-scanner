import { describe, test, expect, vi, beforeEach } from 'vitest';
import { fixtureContext } from '../../../support/fixtures.ts';

vi.mock('../../../../src/lib/clients/ai.client.ts', () => ({
  classifyEmail: vi.fn(),
}));

import { classifyDataset } from '../../../../src/lib/controllers/steps/classify-dataset.step.ts';
import { classifyEmail } from '../../../../src/lib/clients/ai.client.ts';

function makeMessage(bucket, filename, overrides = {}) {
  return {
    bucket,
    filename,
    uid: `${bucket}/${filename}`,
    envelope: {
      from: [{ address: 'sender@example.com' }],
      subject: '',
      date: new Date(),
    },
    raw: `From: sender@example.com\r\n\r\nBody`,
    ...overrides,
  };
}

describe('classifyDataset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('returns an empty array when there are no messages', async () => {
    const ctx = fixtureContext();
    const result = await classifyDataset([], ctx);

    expect(result).toEqual([]);
    expect(classifyEmail).not.toHaveBeenCalled();
  });

  test('attaches score/reasoning on success, preserving bucket/filename', async () => {
    classifyEmail.mockResolvedValue({
      score: 12,
      reasoning: 'looks legitimate',
    });
    const ctx = fixtureContext();

    const result = await classifyDataset(
      [makeMessage('ham', 'a.eml'), makeMessage('spam', 'b.eml')],
      ctx
    );

    expect(result).toEqual([
      {
        bucket: 'ham',
        filename: 'a.eml',
        score: 12,
        reasoning: 'looks legitimate',
        error: null,
      },
      {
        bucket: 'spam',
        filename: 'b.eml',
        score: 12,
        reasoning: 'looks legitimate',
        error: null,
      },
    ]);
  });

  test('fails open on a per-message error without affecting sibling messages or rethrowing', async () => {
    let call = 0;
    classifyEmail.mockImplementation(async () => {
      call++;
      if (call === 2) throw new Error('provider timeout');
      return { score: 5, reasoning: 'ok' };
    });
    const ctx = fixtureContext();

    const result = await classifyDataset(
      [
        makeMessage('ham', 'a.eml'),
        makeMessage('ham', 'b.eml'),
        makeMessage('ham', 'c.eml'),
      ],
      ctx
    );

    const errors = result.map(r => r.error);
    expect(errors.filter(Boolean)).toEqual(['provider timeout']);
    expect(errors.filter(e => e === null)).toHaveLength(2);
    expect(result.find(r => r.filename === 'b.eml')).toMatchObject({
      score: null,
      reasoning: null,
      error: 'provider timeout',
    });
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
    const messages = [1, 2, 3, 4, 5].map(i => makeMessage('ham', `${i}.eml`));

    await classifyDataset(messages, ctx);

    expect(maxInFlight).toBeLessThanOrEqual(2);
  });
});
