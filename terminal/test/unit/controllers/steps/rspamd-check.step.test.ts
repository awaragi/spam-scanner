import { describe, test, expect, vi, beforeEach } from 'vitest';
import { fixtureContext } from '../../../support/fixtures.ts';

const { fakeRspamdClient } = vi.hoisted(() => {
  return { fakeRspamdClient: { checkEmail: vi.fn() } };
});

vi.mock('../../../../src/lib/clients/rspamd.client.ts', () => fakeRspamdClient);

const { processWithRspamd } = await import(
  '../../../../src/lib/controllers/steps/rspamd-check.step.ts'
);

function makeMessage(uid: number, from?: string) {
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

  test('threads senderAuthenticated from rspamd symbols onto spamInfo', async () => {
    const messages = [makeMessage(1)];
    fakeRspamdClient.checkEmail.mockResolvedValue({
      score: 1,
      required_score: 15,
      symbols: { R_DKIM_ALLOW: { score: -0.2 } },
    });

    const result = await processWithRspamd(messages);

    expect(result[0].spamInfo.senderAuthenticated).toBe(true);
  });

  test('resolves envelope data from the raw message and passes it to checkEmail', async () => {
    const raw = `Received: from mail.example.com (unknown [203.0.113.5])\n\tby mx.provider.com (Postfix) with ESMTPS id ABC123\nReturn-Path: <sender@example.com>\nSubject: subject-1\n\nBody`;
    const message = {
      uid: 1,
      envelope: { subject: 'subject-1', date: new Date() },
      raw,
    };
    fakeRspamdClient.checkEmail.mockResolvedValue({
      score: 1,
      required_score: 15,
    });

    await processWithRspamd(
      [message],
      fixtureContext({ config: { IMAP_USER: 'owner@example.com' } })
    );

    expect(fakeRspamdClient.checkEmail).toHaveBeenCalledWith(raw, {
      ip: '203.0.113.5',
      helo: 'mail.example.com',
      from: 'sender@example.com',
      rcpt: 'owner@example.com',
    });
  });

  test('omits Rcpt when IMAP_USER is not an email address', async () => {
    const message = makeMessage(1);
    fakeRspamdClient.checkEmail.mockResolvedValue({
      score: 1,
      required_score: 15,
    });

    await processWithRspamd(
      [message],
      fixtureContext({ config: { IMAP_USER: 'pierre' } })
    );

    expect(fakeRspamdClient.checkEmail).toHaveBeenCalledWith(
      message.raw,
      expect.objectContaining({ rcpt: null })
    );
  });

  test('honors RSPAMD_ENVELOPE_TRUSTED_HOPS to skip internal hops', async () => {
    const raw = `Received: from internal-relay.example.com (internal-relay.example.com [10.0.0.5])\n\tby store.example.com\nReceived: from sender.attacker.example (unknown [203.0.113.9])\n\tby internal-relay.example.com\nSubject: subject-1\n\nBody`;
    const message = {
      uid: 1,
      envelope: { subject: 'subject-1', date: new Date() },
      raw,
    };
    fakeRspamdClient.checkEmail.mockResolvedValue({
      score: 1,
      required_score: 15,
    });

    await processWithRspamd(
      [message],
      fixtureContext({ config: { RSPAMD_ENVELOPE_TRUSTED_HOPS: 1 } })
    );

    expect(fakeRspamdClient.checkEmail).toHaveBeenCalledWith(
      raw,
      expect.objectContaining({
        ip: '203.0.113.9',
        helo: 'sender.attacker.example',
      })
    );
  });

  test('one permanent failure, one success: permanent one skipped, success kept, no throw', async () => {
    const messages = [makeMessage(1), makeMessage(2)];
    fakeRspamdClient.checkEmail.mockImplementation(async raw => {
      if (raw === 'raw-1') {
        const err: Error & { status?: number } = new Error('bad request');
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
        const err: Error & { status?: number } = new Error('bad request');
        err.status = 400;
        throw err;
      }
      throw new Error('network error');
    });

    await expect(processWithRspamd(messages)).rejects.toThrow(/transiently/);
  });
});
