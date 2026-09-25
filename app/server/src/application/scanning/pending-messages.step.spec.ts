import { describe, test, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import type { ImapFlow } from 'imapflow';
import type { Logger as PinoLogger } from 'pino';
import { ScanConfig } from '../../config/app-config.js';
import { defaultMailboxSettings } from '../../config/mailbox-settings.defaults.js';
import type { Mailbox } from '../../infrastructure/mailboxes/mailbox.js';
import type { MailboxFolders } from '../../infrastructure/imap/folder.resolver.js';
import type { MailboxSession } from '../mailbox-session.js';

const { mockOpen, mockSearch, mockReadScannerState, mockWriteScannerState } =
  vi.hoisted(() => ({
    mockOpen: vi.fn(),
    mockSearch: vi.fn(),
    mockReadScannerState: vi.fn(),
    mockWriteScannerState: vi.fn(),
  }));

vi.mock('../../infrastructure/imap/mailbox.gateway.js', () => ({
  open: mockOpen,
  search: mockSearch,
}));

vi.mock('../../infrastructure/state/scanner-state.repository.js', () => ({
  readScannerState: mockReadScannerState,
  writeScannerState: mockWriteScannerState,
}));

const { PendingMessagesStep } = await import('./pending-messages.step.js');

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

function fixtureFolders(
  overrides: Partial<MailboxFolders> = {}
): MailboxFolders {
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
  const logger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: () => logger,
  };
  return logger as unknown as PinoLogger;
}

function fixtureSession(overrides: Partial<MailboxSession> = {}): MailboxSession {
  return {
    mailbox: fixtureMailbox(),
    imap: {} as ImapFlow,
    settings: defaultMailboxSettings,
    folders: fixtureFolders(),
    logger: fixtureLogger(),
    ...overrides,
  };
}

describe('PendingMessagesStep', () => {
  let step: InstanceType<typeof PendingMessagesStep>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockOpen.mockResolvedValue({ uidValidity: 1n, uidNext: 200 });
    mockSearch.mockResolvedValue([]);
    mockWriteScannerState.mockResolvedValue(true);

    const module = await Test.createTestingModule({
      providers: [
        PendingMessagesStep,
        {
          provide: ScanConfig,
          useValue: { batchScanSize: 200, batchProcessSize: 10 },
        },
      ],
    }).compile();

    step = module.get(PendingMessagesStep);
  });

  test('IMAP range inversion: search returns only lastUID, no messages are pending', async () => {
    const session = fixtureSession();
    mockReadScannerState.mockResolvedValue({
      last_uid: 7384,
      last_seen_date: '',
      last_checked: '',
    });
    mockSearch.mockResolvedValue([7384]); // server wraps 7385:* -> [7384]

    const result = await step.locate(session);

    expect(result).toEqual({
      state: expect.objectContaining({ last_uid: 7384 }),
      uids: [],
    });
  });

  test('normal case: search returns UIDs greater than lastUID, all are returned', async () => {
    const session = fixtureSession();
    mockReadScannerState.mockResolvedValue({
      last_uid: 100,
      last_seen_date: '',
      last_checked: '',
    });
    mockSearch.mockResolvedValue([101, 102, 103]);

    const result = await step.locate(session);

    expect(result.uids).toEqual([101, 102, 103]);
  });

  test('mixed case: only UIDs greater than lastUID are returned', async () => {
    const session = fixtureSession();
    mockReadScannerState.mockResolvedValue({
      last_uid: 100,
      last_seen_date: '',
      last_checked: '',
    });
    mockSearch.mockResolvedValue([100, 101, 102]);

    const result = await step.locate(session);

    expect(result.uids).toEqual([101, 102]);
  });

  test('caps the result to the injected ScanConfig.batchScanSize', async () => {
    const module = await Test.createTestingModule({
      providers: [
        PendingMessagesStep,
        { provide: ScanConfig, useValue: { batchScanSize: 2 } },
      ],
    }).compile();
    const cappedStep = module.get(PendingMessagesStep);

    const session = fixtureSession();
    mockReadScannerState.mockResolvedValue({
      last_uid: 100,
      last_seen_date: '',
      last_checked: '',
    });
    mockSearch.mockResolvedValue([101, 102, 103]);

    const result = await cappedStep.locate(session);

    expect(result.uids).toEqual([101, 102]);
  });

  test('mismatched uid_validity: resets to UIDNEXT - 1 instead of the stale last_uid', async () => {
    const session = fixtureSession();
    mockReadScannerState.mockResolvedValue({
      last_uid: 9000,
      last_seen_date: '',
      last_checked: '',
      uid_validity: '111',
    });
    mockOpen.mockResolvedValue({ uidValidity: 222n, uidNext: 6 });
    mockSearch.mockResolvedValue([]);

    const result = await step.locate(session);

    expect(result).toEqual({
      state: expect.objectContaining({ last_uid: 5, uid_validity: '222' }),
      uids: [],
    });
    // Persisted immediately even though nothing new was found, so the next
    // cycle doesn't re-detect the same mismatch and warn again.
    expect(mockWriteScannerState).toHaveBeenCalledWith(
      session.imap,
      session.folders.state,
      expect.objectContaining({ last_uid: 5, uid_validity: '222' }),
      session.logger
    );
  });

  test('no UIDVALIDITY change and nothing new: state is not persisted', async () => {
    const session = fixtureSession();
    mockReadScannerState.mockResolvedValue({
      last_uid: 100,
      last_seen_date: '',
      last_checked: '',
      uid_validity: '1',
    });
    mockOpen.mockResolvedValue({ uidValidity: 1n, uidNext: 101 });
    mockSearch.mockResolvedValue([]);

    await step.locate(session);

    expect(mockWriteScannerState).not.toHaveBeenCalled();
  });
});
