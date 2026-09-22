import { describe, test, expect, vi, beforeEach } from 'vitest';
import { fixtureContext } from '../../../support/fixtures.js';

const { fakeImapClient, fakeStateManager } = await vi.hoisted(async () => {
  const { createFakeImapClient, createFakeStateManagerClient } = await import(
    '../../../support/fake-clients.js'
  );
  return {
    fakeImapClient: createFakeImapClient(),
    fakeStateManager: createFakeStateManagerClient(),
  };
});

vi.mock('../../../../src/lib/clients/imap.client.js', () => fakeImapClient);
vi.mock(
  '../../../../src/lib/clients/state-manager.client.js',
  () => fakeStateManager
);

const { runWhitelist, runBlacklist } = await import(
  '../../../../src/lib/controllers/workflows/sender-list-training.controller.js'
);

const mockImap = {};

function makeMessage(uid, from) {
  return { uid, headers: { from } };
}

// Wires fakeImapClient.search to return the UIDs of `messages`, and
// fetchMessageHeadersByUIDs to return the corresponding fixture messages for
// whatever sub-batch of UIDs it's called with.
function stubUidsAndFetch(messages) {
  const byUid = new Map(messages.map(m => [m.uid, m]));
  fakeImapClient.search.mockResolvedValue(messages.map(m => m.uid));
  fakeImapClient.fetchMessageHeadersByUIDs.mockImplementation(
    async (imap, batchUids) => batchUids.map(uid => byUid.get(uid))
  );
}

describe('sender-list-training.controller: messages with no extractable sender are still moved on', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeImapClient.open.mockResolvedValue({});
  });

  test('no messages in folder: nothing is fetched or moved', async () => {
    fakeImapClient.count.mockReturnValue(0);

    await runWhitelist(mockImap, fixtureContext());

    expect(fakeImapClient.search).not.toHaveBeenCalled();
    expect(fakeImapClient.fetchMessageHeadersByUIDs).not.toHaveBeenCalled();
    expect(fakeImapClient.moveMessages).not.toHaveBeenCalled();
  });

  test('no extractable senders: messages are still moved on, list is left untouched', async () => {
    const messages = [makeMessage(1, undefined), makeMessage(2, undefined)];
    fakeImapClient.count.mockReturnValue(2);
    stubUidsAndFetch(messages);
    const ctx = fixtureContext({ config: { FOLDER_INBOX: 'INBOX' } });

    await runWhitelist(mockImap, ctx);

    expect(fakeStateManager.writeMapState).not.toHaveBeenCalled();
    expect(fakeImapClient.moveMessages).toHaveBeenCalledWith(
      mockImap,
      messages,
      'INBOX'
    );
  });

  test('extractable senders: IMAP-backed list is updated in append mode and messages are moved on', async () => {
    const messages = [makeMessage(1, 'sender@example.com')];
    fakeImapClient.count.mockReturnValue(1);
    stubUidsAndFetch(messages);
    fakeStateManager.readMapState.mockResolvedValue([]);
    const ctx = fixtureContext({
      config: {
        FOLDER_INBOX: 'INBOX',
        STATE_KEY_WHITELIST_MAP: 'rspamd-whitelist-map',
      },
    });

    await runWhitelist(mockImap, ctx);

    expect(fakeStateManager.writeMapState).toHaveBeenCalledWith(
      mockImap,
      'rspamd-whitelist-map',
      JSON.stringify(['sender@example.com'], null, 2)
    );
    expect(fakeImapClient.moveMessages).toHaveBeenCalledWith(
      mockImap,
      messages,
      'INBOX'
    );
  });

  test('a sender already covered by an existing domain entry is not re-added', async () => {
    const messages = [makeMessage(1, 'bob@example.com')];
    fakeImapClient.count.mockReturnValue(1);
    stubUidsAndFetch(messages);
    fakeStateManager.readMapState.mockResolvedValue(['@example.com']);
    const ctx = fixtureContext({ config: { FOLDER_INBOX: 'INBOX' } });

    await runWhitelist(mockImap, ctx);

    expect(fakeStateManager.writeMapState).not.toHaveBeenCalled();
    expect(fakeImapClient.moveMessages).toHaveBeenCalledWith(
      mockImap,
      messages,
      'INBOX'
    );
  });

  test('runBlacklist moves messages to FOLDER_SPAM', async () => {
    const messages = [makeMessage(1, 'sender@example.com')];
    fakeImapClient.count.mockReturnValue(1);
    stubUidsAndFetch(messages);
    fakeStateManager.readMapState.mockResolvedValue([]);
    const ctx = fixtureContext({
      config: {
        FOLDER_SPAM: 'INBOX.spam',
        STATE_KEY_BLACKLIST_MAP: 'rspamd-blacklist-map',
      },
    });

    await runBlacklist(mockImap, ctx);

    expect(fakeImapClient.moveMessages).toHaveBeenCalledWith(
      mockImap,
      messages,
      'INBOX.spam'
    );
  });

  test('fetches headers only, never full source/body', async () => {
    const messages = [makeMessage(1, 'sender@example.com')];
    fakeImapClient.count.mockReturnValue(1);
    stubUidsAndFetch(messages);
    fakeStateManager.readMapState.mockResolvedValue([]);
    const ctx = fixtureContext({ config: { FOLDER_INBOX: 'INBOX' } });

    await runWhitelist(mockImap, ctx);

    expect(fakeImapClient.fetchMessageHeadersByUIDs).toHaveBeenCalledWith(
      mockImap,
      [1]
    );
  });

  test('more than PROCESS_BATCH_SIZE UIDs are fetched in more than one bounded call', async () => {
    const messages = Array.from({ length: 25 }, (_, i) =>
      makeMessage(i + 1, `sender${i + 1}@example.com`)
    );
    fakeImapClient.count.mockReturnValue(messages.length);
    stubUidsAndFetch(messages);
    fakeStateManager.readMapState.mockResolvedValue([]);
    const ctx = fixtureContext({
      config: { FOLDER_INBOX: 'INBOX', PROCESS_BATCH_SIZE: 10 },
    });

    await runWhitelist(mockImap, ctx);

    expect(fakeImapClient.fetchMessageHeadersByUIDs).toHaveBeenCalledTimes(3);
    for (const call of fakeImapClient.fetchMessageHeadersByUIDs.mock.calls) {
      expect(call[1].length).toBeLessThanOrEqual(10);
    }
  });
});
