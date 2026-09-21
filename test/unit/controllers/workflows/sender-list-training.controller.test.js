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

describe('sender-list-training.controller: messages with no extractable sender are still moved on', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeImapClient.open.mockResolvedValue({});
  });

  test('no messages in folder: nothing is fetched or moved', async () => {
    fakeImapClient.count.mockReturnValue(0);

    await runWhitelist(mockImap, fixtureContext());

    expect(fakeImapClient.fetchAllMessages).not.toHaveBeenCalled();
    expect(fakeImapClient.moveMessages).not.toHaveBeenCalled();
  });

  test('no extractable senders: messages are still moved on, list is left untouched', async () => {
    const messages = [makeMessage(1, undefined), makeMessage(2, undefined)];
    fakeImapClient.count.mockReturnValue(2);
    fakeImapClient.fetchAllMessages.mockResolvedValue(messages);
    const ctx = fixtureContext({ config: { FOLDER_INBOX: 'INBOX' } });

    await runWhitelist(mockImap, ctx);

    expect(fakeStateManager.writeMapState).not.toHaveBeenCalled();
    expect(fakeImapClient.moveMessages).toHaveBeenCalledWith(
      mockImap,
      messages,
      'INBOX'
    );
  });

  test('no extractable senders: messages are still tagged $ScannerTrained before moving', async () => {
    const messages = [makeMessage(1, undefined)];
    fakeImapClient.count.mockReturnValue(1);
    fakeImapClient.fetchAllMessages.mockResolvedValue(messages);
    const ctx = fixtureContext({ config: { FOLDER_INBOX: 'INBOX' } });

    await runWhitelist(mockImap, ctx);

    expect(fakeImapClient.updateLabels).toHaveBeenCalledWith(
      mockImap,
      messages,
      ['$ScannerTrained']
    );
  });

  test('extractable senders: IMAP-backed list is updated in append mode and messages are moved on', async () => {
    const messages = [makeMessage(1, 'sender@example.com')];
    fakeImapClient.count.mockReturnValue(1);
    fakeImapClient.fetchAllMessages.mockResolvedValue(messages);
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
    expect(fakeImapClient.updateLabels).toHaveBeenCalledWith(
      mockImap,
      messages,
      ['$ScannerTrained']
    );
    expect(fakeImapClient.moveMessages).toHaveBeenCalledWith(
      mockImap,
      messages,
      'INBOX'
    );
  });

  test('runBlacklist never tags moved messages with $ScannerTrained', async () => {
    const messages = [makeMessage(1, 'sender@example.com')];
    fakeImapClient.count.mockReturnValue(1);
    fakeImapClient.fetchAllMessages.mockResolvedValue(messages);
    fakeStateManager.readMapState.mockResolvedValue([]);
    const ctx = fixtureContext({
      config: {
        FOLDER_SPAM: 'INBOX.spam',
        STATE_KEY_BLACKLIST_MAP: 'rspamd-blacklist-map',
      },
    });

    await runBlacklist(mockImap, ctx);

    expect(fakeImapClient.updateLabels).not.toHaveBeenCalled();
    expect(fakeImapClient.moveMessages).toHaveBeenCalledWith(
      mockImap,
      messages,
      'INBOX.spam'
    );
  });
});
