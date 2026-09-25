import { describe, test, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import type { Logger as PinoLogger } from 'pino';
import { asImapFlow } from '../../../test/support/imap-fakes.js';
import type { MailboxSession } from '../mailbox-session.js';
import type { Mailbox } from '../../infrastructure/mailboxes/mailbox.js';
import type { MailboxFolders } from '../../infrastructure/imap/folder.resolver.js';
import { defaultMailboxSettings } from '../../config/mailbox-settings.defaults.js';
import { ScanConfig } from '../../config/app-config.js';

const {
  mockOpen,
  mockCount,
  mockSearch,
  mockFetchHeadersByUIDs,
  mockMoveMessages,
  mockReadMapState,
  mockWriteMapState,
} = vi.hoisted(() => ({
  mockOpen: vi.fn(),
  mockCount: vi.fn(),
  mockSearch: vi.fn(),
  mockFetchHeadersByUIDs: vi.fn(),
  mockMoveMessages: vi.fn(),
  mockReadMapState: vi.fn(),
  mockWriteMapState: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../infrastructure/imap/mailbox.gateway.js', () => ({
  open: mockOpen,
  count: mockCount,
  search: mockSearch,
  fetchMessageHeadersByUIDs: mockFetchHeadersByUIDs,
  moveMessages: mockMoveMessages,
}));

vi.mock('../../infrastructure/state/sender-list.repository.js', () => ({
  readMapState: mockReadMapState,
  writeMapState: mockWriteMapState,
}));

import { SenderListTrainingService } from './sender-list-training.service.js';

const mockImap = asImapFlow({});

function fixtureMailbox(overrides: Partial<Mailbox> = {}): Mailbox {
  return {
    id: 'owner@example.com',
    imapHost: 'imap.example.com',
    imapPort: 993,
    imapUser: 'owner@example.com',
    imapPassword: 'secret',
    imapTls: true,
    imapAllowInsecure: false,
    stateFolder: 'INBOX.scanner.state',
    ...overrides,
  };
}

function fixtureFolders(overrides: Partial<MailboxFolders> = {}): MailboxFolders {
  return {
    inbox: 'INBOX',
    spam: 'INBOX.spam',
    spamLow: 'INBOX.spam.low',
    spamHigh: 'INBOX.spam.high',
    trainSpam: 'INBOX.scanner.train.spam',
    trainHam: 'INBOX.scanner.train.ham',
    trainWhitelist: 'INBOX.scanner.train.whitelist',
    trainBlacklist: 'INBOX.scanner.train.blacklist',
    state: 'INBOX.scanner.state',
    ...overrides,
  };
}

function fixtureLogger(): PinoLogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as PinoLogger;
}

function fixtureSession(overrides: Partial<MailboxSession> = {}): MailboxSession {
  return {
    mailbox: fixtureMailbox(),
    imap: mockImap,
    settings: defaultMailboxSettings,
    folders: fixtureFolders(),
    logger: fixtureLogger(),
    ...overrides,
  };
}

function makeMessage(uid: number, from: string | undefined) {
  return { uid, headers: { from } };
}

// Wires mockSearch to return the UIDs of `messages`, and
// fetchMessageHeadersByUIDs to return the corresponding fixture messages for
// whatever sub-batch of UIDs it's called with.
function stubUidsAndFetch(messages: ReturnType<typeof makeMessage>[]) {
  const byUid = new Map(messages.map(m => [m.uid, m]));
  mockSearch.mockResolvedValue(messages.map(m => m.uid));
  mockFetchHeadersByUIDs.mockImplementation(
    async (_imap: unknown, batchUids: number[]) => batchUids.map(uid => byUid.get(uid))
  );
}

async function buildService(scanConfig: Partial<ScanConfig> = {}): Promise<SenderListTrainingService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      SenderListTrainingService,
      {
        provide: ScanConfig,
        useValue: { batchProcessSize: 100, scanIntervalSeconds: 300, batchScanSize: 100, maxRetries: 5, ...scanConfig },
      },
    ],
  }).compile();

  return moduleRef.get(SenderListTrainingService);
}

describe('SenderListTrainingService: messages with no extractable sender are still moved on', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOpen.mockResolvedValue({});
    mockWriteMapState.mockResolvedValue(true);
  });

  test('no messages in folder: nothing is fetched or moved', async () => {
    mockCount.mockReturnValue(0);
    const service = await buildService();

    await service.runWhitelist(fixtureSession());

    expect(mockSearch).not.toHaveBeenCalled();
    expect(mockFetchHeadersByUIDs).not.toHaveBeenCalled();
    expect(mockMoveMessages).not.toHaveBeenCalled();
  });

  test('no extractable senders: messages are still moved on, list is left untouched', async () => {
    const messages = [makeMessage(1, undefined), makeMessage(2, undefined)];
    mockCount.mockReturnValue(2);
    stubUidsAndFetch(messages);
    mockReadMapState.mockResolvedValue([]);
    const service = await buildService();

    await service.runWhitelist(fixtureSession({ folders: fixtureFolders({ inbox: 'INBOX' }) }));

    expect(mockWriteMapState).not.toHaveBeenCalled();
    expect(mockMoveMessages).toHaveBeenCalledWith(mockImap, messages, 'INBOX', expect.anything());
  });

  test('extractable senders: IMAP-backed list is updated in append mode and messages are moved on', async () => {
    const messages = [makeMessage(1, 'sender@example.com')];
    mockCount.mockReturnValue(1);
    stubUidsAndFetch(messages);
    mockReadMapState.mockResolvedValue([]);
    const service = await buildService();

    await service.runWhitelist(
      fixtureSession({
        folders: fixtureFolders({ inbox: 'INBOX', state: 'INBOX.scanner.state' }),
      })
    );

    expect(mockWriteMapState).toHaveBeenCalledWith(
      mockImap,
      'INBOX.scanner.state',
      'rspamd-whitelist-map',
      JSON.stringify(['sender@example.com'], null, 2),
      expect.anything()
    );
    expect(mockMoveMessages).toHaveBeenCalledWith(mockImap, messages, 'INBOX', expect.anything());
  });

  test('a sender already covered by an existing domain entry is not re-added', async () => {
    const messages = [makeMessage(1, 'bob@example.com')];
    mockCount.mockReturnValue(1);
    stubUidsAndFetch(messages);
    mockReadMapState.mockResolvedValue(['@example.com']);
    const service = await buildService();

    await service.runWhitelist(fixtureSession({ folders: fixtureFolders({ inbox: 'INBOX' }) }));

    expect(mockWriteMapState).not.toHaveBeenCalled();
    expect(mockMoveMessages).toHaveBeenCalledWith(mockImap, messages, 'INBOX', expect.anything());
  });

  test('runBlacklist moves messages to the spam folder', async () => {
    const messages = [makeMessage(1, 'sender@example.com')];
    mockCount.mockReturnValue(1);
    stubUidsAndFetch(messages);
    mockReadMapState.mockResolvedValue([]);
    const service = await buildService();

    await service.runBlacklist(
      fixtureSession({ folders: fixtureFolders({ spam: 'INBOX.spam' }) })
    );

    expect(mockMoveMessages).toHaveBeenCalledWith(mockImap, messages, 'INBOX.spam', expect.anything());
  });

  test('fetches headers only, never full source/body', async () => {
    const messages = [makeMessage(1, 'sender@example.com')];
    mockCount.mockReturnValue(1);
    stubUidsAndFetch(messages);
    mockReadMapState.mockResolvedValue([]);
    const service = await buildService();

    await service.runWhitelist(fixtureSession());

    expect(mockFetchHeadersByUIDs).toHaveBeenCalledWith(mockImap, [1], expect.anything());
  });

  test('more than batchProcessSize UIDs are fetched in more than one bounded call', async () => {
    const messages = Array.from({ length: 25 }, (_, i) =>
      makeMessage(i + 1, `sender${i + 1}@example.com`)
    );
    mockCount.mockReturnValue(messages.length);
    stubUidsAndFetch(messages);
    mockReadMapState.mockResolvedValue([]);
    const service = await buildService({ batchProcessSize: 10 });

    await service.runWhitelist(fixtureSession());

    expect(mockFetchHeadersByUIDs).toHaveBeenCalledTimes(3);
    for (const call of mockFetchHeadersByUIDs.mock.calls) {
      expect(call[1].length).toBeLessThanOrEqual(10);
    }
  });

  test('a failure opening/reading the training folder is logged and rethrown, not swallowed', async () => {
    mockCount.mockReturnValue(5);
    mockSearch.mockRejectedValue(new Error('connection dropped'));
    const service = await buildService();
    const session = fixtureSession();

    await expect(service.runWhitelist(session)).rejects.toThrow('connection dropped');

    expect(session.logger.error).toHaveBeenCalled();
    expect(mockMoveMessages).not.toHaveBeenCalled();
  });
});
