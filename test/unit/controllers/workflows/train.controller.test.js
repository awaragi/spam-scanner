import { describe, test, expect, vi, beforeEach } from 'vitest';
import { fixtureContext } from '../../../support/fixtures.js';

const { fakeImapClient, fakeRspamdClient } = await vi.hoisted(async () => {
  const { createFakeImapClient, createFakeRspamdClient } = await import(
    '../../../support/fake-clients.js'
  );
  return {
    fakeImapClient: createFakeImapClient(),
    fakeRspamdClient: createFakeRspamdClient(),
  };
});

vi.mock('../../../../src/lib/clients/imap.client.js', () => fakeImapClient);
vi.mock('../../../../src/lib/clients/rspamd.client.js', () => fakeRspamdClient);

const { runSpam, runHam } = await import(
  '../../../../src/lib/controllers/workflows/train.controller.js'
);

const mockImap = {};

function makeMessage(uid) {
  return { uid, envelope: { subject: `subject-${uid}` }, raw: `raw-${uid}` };
}

// Wires fakeImapClient.search to return `uids`, and fetchMessagesByUIDs to
// return the corresponding fixture messages for whatever sub-batch of UIDs
// it's called with - mirrors the real client's search-then-batch-fetch shape.
function stubUidsAndFetch(uids) {
  const byUid = new Map(uids.map(uid => [uid, makeMessage(uid)]));
  fakeImapClient.search.mockResolvedValue(uids);
  fakeImapClient.fetchMessagesByUIDs.mockImplementation(
    async (imap, batchUids) => batchUids.map(uid => byUid.get(uid))
  );
  return byUid;
}

describe('train.controller: per-message failure isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeImapClient.open.mockResolvedValue({});
  });

  test('no messages in folder: search/fetchMessagesByUIDs/trainFn/moveMessages are never called', async () => {
    fakeImapClient.count.mockReturnValue(0);
    const ctx = fixtureContext();

    await runSpam(mockImap, ctx);

    expect(fakeImapClient.search).not.toHaveBeenCalled();
    expect(fakeImapClient.fetchMessagesByUIDs).not.toHaveBeenCalled();
    expect(fakeRspamdClient.learnSpam).not.toHaveBeenCalled();
    expect(fakeImapClient.moveMessages).not.toHaveBeenCalled();
  });

  test('UIDs are searched before any message content is fetched', async () => {
    fakeImapClient.count.mockReturnValue(1);
    stubUidsAndFetch([1]);
    fakeRspamdClient.learnSpam.mockResolvedValue({ success: true });

    await runSpam(mockImap, fixtureContext());

    expect(fakeImapClient.search).toHaveBeenCalledWith(mockImap, {
      all: true,
    });
  });

  test('more than BATCH_PROCESS_SIZE UIDs are fetched in more than one bounded call', async () => {
    const uids = Array.from({ length: 25 }, (_, i) => i + 1); // 3 batches of 10
    fakeImapClient.count.mockReturnValue(uids.length);
    stubUidsAndFetch(uids);
    fakeRspamdClient.learnSpam.mockResolvedValue({ success: true });
    const ctx = fixtureContext({ config: { BATCH_PROCESS_SIZE: 10 } });

    await runSpam(mockImap, ctx);

    expect(fakeImapClient.fetchMessagesByUIDs).toHaveBeenCalledTimes(3);
    for (const call of fakeImapClient.fetchMessagesByUIDs.mock.calls) {
      expect(call[1].length).toBeLessThanOrEqual(10);
    }
  });

  test('a batch already trained and moved survives a later batch fetch failure', async () => {
    const uids = [1, 2];
    fakeImapClient.count.mockReturnValue(uids.length);
    stubUidsAndFetch(uids);
    fakeImapClient.fetchMessagesByUIDs.mockImplementationOnce(async () => [
      makeMessage(1),
    ]);
    fakeImapClient.fetchMessagesByUIDs.mockImplementationOnce(async () => {
      throw new Error('connection dropped mid-run');
    });
    fakeRspamdClient.learnSpam.mockResolvedValue({ success: true });
    const ctx = fixtureContext({
      config: { BATCH_PROCESS_SIZE: 1, FOLDER_SPAM: 'INBOX.spam' },
    });

    await expect(runSpam(mockImap, ctx)).resolves.toBeUndefined();

    // First batch's message was still moved despite the second batch's fetch failing.
    expect(fakeImapClient.moveMessages).toHaveBeenCalledTimes(1);
    expect(fakeImapClient.moveMessages).toHaveBeenCalledWith(
      mockImap,
      [makeMessage(1)],
      'INBOX.spam'
    );
  });

  test('a permanently-failing message in a batch is still moved, alongside the learned ones', async () => {
    fakeImapClient.count.mockReturnValue(3);
    stubUidsAndFetch([1, 2, 3]);
    fakeRspamdClient.learnSpam.mockImplementation(async raw => {
      if (raw === 'raw-2') {
        const err = new Error('bad request');
        err.status = 400;
        throw err;
      }
      return { success: true };
    });
    const ctx = fixtureContext({ config: { FOLDER_SPAM: 'INBOX.spam' } });

    await runSpam(mockImap, ctx);

    expect(fakeImapClient.moveMessages).toHaveBeenCalledWith(
      mockImap,
      [makeMessage(1), makeMessage(3), makeMessage(2)],
      'INBOX.spam'
    );
  });

  test('transient training failure does not throw: it is logged and swallowed, moveMessages is never called for it', async () => {
    fakeImapClient.count.mockReturnValue(2);
    stubUidsAndFetch([1, 2]);
    fakeRspamdClient.learnHam.mockRejectedValue(new Error('network error'));

    await expect(runHam(mockImap, fixtureContext())).resolves.toBeUndefined();

    expect(fakeImapClient.moveMessages).not.toHaveBeenCalled();
  });

  test('a failure opening/reading the training folder itself does not throw either', async () => {
    fakeImapClient.count.mockReturnValue(5);
    fakeImapClient.search.mockRejectedValue(new Error('connection dropped'));

    await expect(runSpam(mockImap, fixtureContext())).resolves.toBeUndefined();

    expect(fakeImapClient.moveMessages).not.toHaveBeenCalled();
  });
});
