import { describe, test, expect, vi, beforeEach } from 'vitest';
import { fixtureContext } from '../../support/fixtures.js';

const { fakeImapClient, fakeRspamdClient } = await vi.hoisted(async () => {
  const { createFakeImapClient, createFakeRspamdClient } = await import(
    '../../support/fake-clients.js'
  );
  return {
    fakeImapClient: createFakeImapClient(),
    fakeRspamdClient: createFakeRspamdClient(),
  };
});

vi.mock('../../../src/lib/clients/imap.client.js', () => fakeImapClient);
vi.mock('../../../src/lib/clients/rspamd.client.js', () => fakeRspamdClient);

const { runSpam, runHam } = await import(
  '../../../src/lib/controllers/workflows/train.controller.js'
);

const mockImap = {};

function makeMessage(uid) {
  return { uid, envelope: { subject: `subject-${uid}` }, raw: `raw-${uid}` };
}

describe('train.controller: per-message failure isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeImapClient.open.mockResolvedValue({});
  });

  test('no messages in folder: trainFn and moveMessages are never called', async () => {
    fakeImapClient.count.mockReturnValue(0);
    const ctx = fixtureContext();

    await runSpam(mockImap, ctx);

    expect(fakeImapClient.fetchAllMessages).not.toHaveBeenCalled();
    expect(fakeRspamdClient.learnSpam).not.toHaveBeenCalled();
    expect(fakeImapClient.moveMessages).not.toHaveBeenCalled();
  });

  test('a permanently-failing message in a batch is still moved, alongside the learned ones', async () => {
    const messages = [makeMessage(1), makeMessage(2), makeMessage(3)];
    fakeImapClient.count.mockReturnValue(3);
    fakeImapClient.fetchAllMessages.mockResolvedValue(messages);
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
      [messages[0], messages[2], messages[1]],
      'INBOX.spam'
    );
  });

  test('transient training failure does not throw: it is logged and swallowed, moveMessages is never called for it', async () => {
    const messages = [makeMessage(1), makeMessage(2)];
    fakeImapClient.count.mockReturnValue(2);
    fakeImapClient.fetchAllMessages.mockResolvedValue(messages);
    fakeRspamdClient.learnHam.mockRejectedValue(new Error('network error'));

    await expect(runHam(mockImap, fixtureContext())).resolves.toBeUndefined();

    expect(fakeImapClient.moveMessages).not.toHaveBeenCalled();
  });

  test('a failure opening/reading the training folder itself does not throw either', async () => {
    fakeImapClient.count.mockReturnValue(5);
    fakeImapClient.fetchAllMessages.mockRejectedValue(
      new Error('connection dropped')
    );

    await expect(runSpam(mockImap, fixtureContext())).resolves.toBeUndefined();

    expect(fakeImapClient.moveMessages).not.toHaveBeenCalled();
  });
});
