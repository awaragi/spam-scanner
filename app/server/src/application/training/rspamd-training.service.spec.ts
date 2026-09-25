import { describe, test, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import type { Logger as PinoLogger } from 'pino';
import { asImapFlow } from '../../../test/support/imap-fakes.js';
import type { MailboxSession } from '../mailbox-session.js';
import type { Mailbox } from '../../infrastructure/mailboxes/mailbox.js';
import type { MailboxFolders } from '../../infrastructure/imap/folder.resolver.js';
import { defaultMailboxSettings } from '../../config/mailbox-settings.defaults.js';
import { ScanConfig } from '../../config/app-config.js';
import { RspamdGateway } from '../../infrastructure/rspamd/rspamd.gateway.js';

const { mockOpen, mockCount, mockSearch, mockFetchByUIDs, mockMoveMessages } = vi.hoisted(() => ({
  mockOpen: vi.fn(),
  mockCount: vi.fn(),
  mockSearch: vi.fn(),
  mockFetchByUIDs: vi.fn(),
  mockMoveMessages: vi.fn(),
}));

vi.mock('../../infrastructure/imap/mailbox.gateway.js', () => ({
  open: mockOpen,
  count: mockCount,
  search: mockSearch,
  fetchMessagesByUIDs: mockFetchByUIDs,
  moveMessages: mockMoveMessages,
}));

import { RspamdTrainingService } from './rspamd-training.service.js';

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

function makeMessage(uid: number) {
  return { uid, envelope: { subject: `subject-${uid}` }, raw: `raw-${uid}` };
}

// Wires mockSearch to return `uids`, and fetchMessagesByUIDs to return the
// corresponding fixture messages for whatever sub-batch of UIDs it's called
// with - mirrors the real gateway's search-then-batch-fetch shape.
function stubUidsAndFetch(uids: number[]) {
  const byUid = new Map(uids.map(uid => [uid, makeMessage(uid)]));
  mockSearch.mockResolvedValue(uids);
  mockFetchByUIDs.mockImplementation(async (_imap: unknown, batchUids: number[]) =>
    batchUids.map(uid => byUid.get(uid))
  );
  return byUid;
}

async function buildService(
  rspamd: Partial<RspamdGateway>,
  scanConfig: Partial<ScanConfig> = {}
): Promise<RspamdTrainingService> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      RspamdTrainingService,
      { provide: RspamdGateway, useValue: rspamd },
      {
        provide: ScanConfig,
        useValue: { batchProcessSize: 100, scanIntervalSeconds: 300, batchScanSize: 100, maxRetries: 5, ...scanConfig },
      },
    ],
  }).compile();

  return moduleRef.get(RspamdTrainingService);
}

describe('RspamdTrainingService: per-message failure isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOpen.mockResolvedValue({});
  });

  test('no messages in folder: search/fetchMessagesByUIDs/learn/moveMessages are never called', async () => {
    mockCount.mockReturnValue(0);
    const learnSpam = vi.fn();
    const service = await buildService({ learnSpam });

    await service.runSpam(fixtureSession());

    expect(mockSearch).not.toHaveBeenCalled();
    expect(mockFetchByUIDs).not.toHaveBeenCalled();
    expect(learnSpam).not.toHaveBeenCalled();
    expect(mockMoveMessages).not.toHaveBeenCalled();
  });

  test('UIDs are searched before any message content is fetched', async () => {
    mockCount.mockReturnValue(1);
    stubUidsAndFetch([1]);
    const learnSpam = vi.fn().mockResolvedValue({ success: true });
    const service = await buildService({ learnSpam });

    await service.runSpam(fixtureSession());

    expect(mockSearch).toHaveBeenCalledWith(mockImap, { all: true }, expect.anything());
  });

  test('more than batchProcessSize UIDs are fetched in more than one bounded call', async () => {
    const uids = Array.from({ length: 25 }, (_, i) => i + 1); // 3 batches of 10
    mockCount.mockReturnValue(uids.length);
    stubUidsAndFetch(uids);
    const learnSpam = vi.fn().mockResolvedValue({ success: true });
    const service = await buildService({ learnSpam }, { batchProcessSize: 10 });

    await service.runSpam(fixtureSession());

    expect(mockFetchByUIDs).toHaveBeenCalledTimes(3);
    for (const call of mockFetchByUIDs.mock.calls) {
      expect(call[1].length).toBeLessThanOrEqual(10);
    }
  });

  test('a batch already trained and moved survives a later batch fetch failure', async () => {
    const uids = [1, 2];
    mockCount.mockReturnValue(uids.length);
    stubUidsAndFetch(uids);
    mockFetchByUIDs.mockImplementationOnce(async () => [makeMessage(1)]);
    mockFetchByUIDs.mockImplementationOnce(async () => {
      throw new Error('connection dropped mid-run');
    });
    const learnSpam = vi.fn().mockResolvedValue({ success: true });
    const service = await buildService({ learnSpam }, { batchProcessSize: 1 });

    await expect(
      service.runSpam(fixtureSession({ folders: fixtureFolders({ spam: 'INBOX.spam' }) }))
    ).resolves.toBeUndefined();

    // First batch's message was still moved despite the second batch's fetch failing.
    expect(mockMoveMessages).toHaveBeenCalledTimes(1);
    expect(mockMoveMessages).toHaveBeenCalledWith(
      mockImap,
      [makeMessage(1)],
      'INBOX.spam',
      expect.anything()
    );
  });

  test('a permanently-failing message in a batch is still moved, alongside the learned ones', async () => {
    mockCount.mockReturnValue(3);
    stubUidsAndFetch([1, 2, 3]);
    const learnSpam = vi.fn().mockImplementation(async raw => {
      if (raw === 'raw-2') {
        const err: Error & { status?: number } = new Error('bad request');
        err.status = 400;
        throw err;
      }
      return { success: true };
    });
    const service = await buildService({ learnSpam });

    await service.runSpam(fixtureSession({ folders: fixtureFolders({ spam: 'INBOX.spam' }) }));

    expect(mockMoveMessages).toHaveBeenCalledWith(
      mockImap,
      [makeMessage(1), makeMessage(3), makeMessage(2)],
      'INBOX.spam',
      expect.anything()
    );
  });

  test('transient training failure does not throw: it is logged and swallowed, moveMessages is never called for it', async () => {
    mockCount.mockReturnValue(2);
    stubUidsAndFetch([1, 2]);
    const learnHam = vi.fn().mockRejectedValue(new Error('network error'));
    const service = await buildService({ learnHam });
    const session = fixtureSession();

    await expect(service.runHam(session)).resolves.toBeUndefined();

    expect(mockMoveMessages).not.toHaveBeenCalled();
    expect(session.logger.error).toHaveBeenCalled();
  });

  test('a spam-training run calls learnSpam with the session mailbox id', async () => {
    mockCount.mockReturnValue(1);
    stubUidsAndFetch([1]);
    const learnSpam = vi.fn().mockResolvedValue({ success: true });
    const service = await buildService({ learnSpam });

    await service.runSpam(
      fixtureSession({ mailbox: fixtureMailbox({ id: 'owner@example.com' }) })
    );

    expect(learnSpam).toHaveBeenCalledWith('raw-1', 'owner@example.com');
  });

  test('a ham-training run calls learnHam with the session mailbox id', async () => {
    mockCount.mockReturnValue(1);
    stubUidsAndFetch([1]);
    const learnHam = vi.fn().mockResolvedValue({ success: true });
    const service = await buildService({ learnHam });

    await service.runHam(
      fixtureSession({ mailbox: fixtureMailbox({ id: 'owner@example.com' }) })
    );

    expect(learnHam).toHaveBeenCalledWith('raw-1', 'owner@example.com');
  });

  test('a failure opening/reading the training folder itself does not throw either', async () => {
    mockCount.mockReturnValue(5);
    mockSearch.mockRejectedValue(new Error('connection dropped'));
    const service = await buildService({ learnSpam: vi.fn() });
    const session = fixtureSession();

    await expect(service.runSpam(session)).resolves.toBeUndefined();

    expect(mockMoveMessages).not.toHaveBeenCalled();
    expect(session.logger.error).toHaveBeenCalled();
  });
});
