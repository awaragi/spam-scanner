import { describe, test, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import type { Logger as PinoLogger } from 'pino';
import { asImapFlow } from '../../../test/support/imap-fakes.js';
import { ScanConfig, AiConfig, RspamdConfig } from '../../config/app-config.js';
import { defaultMailboxSettings } from '../../config/mailbox-settings.defaults.js';
import type { Mailbox } from '../../infrastructure/mailboxes/mailbox.js';
import type { MailboxFolders } from '../../infrastructure/imap/folder.resolver.js';
import { RspamdGateway } from '../../infrastructure/rspamd/rspamd.gateway.js';
import { AiGateway } from '../../infrastructure/ai/ai.gateway.js';
import { AiFailureTracker } from '../../domain/ai/ai-failure-tracker.js';
import type { MailboxSession } from '../mailbox-session.js';

const {
  mockOpen,
  mockSearch,
  mockFetchMessagesByUIDs,
  mockMoveMessages,
  mockUpdateLabels,
  mockReadScannerState,
  mockWriteScannerState,
  mockReadMapState,
} = vi.hoisted(() => ({
  mockOpen: vi.fn(),
  mockSearch: vi.fn(),
  mockFetchMessagesByUIDs: vi.fn(),
  mockMoveMessages: vi.fn(),
  mockUpdateLabels: vi.fn(),
  mockReadScannerState: vi.fn(),
  mockWriteScannerState: vi.fn(),
  mockReadMapState: vi.fn(),
}));

vi.mock('../../infrastructure/imap/mailbox.gateway.js', () => ({
  open: mockOpen,
  search: mockSearch,
  fetchMessagesByUIDs: mockFetchMessagesByUIDs,
  moveMessages: mockMoveMessages,
  updateLabels: mockUpdateLabels,
}));

vi.mock('../../infrastructure/state/scanner-state.repository.js', () => ({
  readScannerState: mockReadScannerState,
  writeScannerState: mockWriteScannerState,
}));

vi.mock('../../infrastructure/state/sender-list.repository.js', () => ({
  readMapState: mockReadMapState,
}));

const { ScanService } = await import('./scan.service.js');
const { PendingMessagesStep } = await import('./pending-messages.step.js');
const { RspamdCheckStep } = await import('./rspamd-check.step.js');
const { AiClassificationStep } = await import('./ai-classification.step.js');
const { DispositionStep } = await import('./disposition.step.js');
const { SenderListLookupStep } = await import('./sender-list-lookup.step.js');

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

function fixtureSession(
  overrides: Partial<MailboxSession> = {}
): MailboxSession {
  return {
    mailbox: fixtureMailbox(),
    imap: asImapFlow({}),
    settings: defaultMailboxSettings,
    folders: fixtureFolders(),
    logger: fixtureLogger(),
    ...overrides,
  };
}

function fixtureMessage({
  uid,
  from = 'sender@example.com',
}: {
  uid: number;
  from?: string;
}) {
  return {
    uid,
    flags: [],
    envelope: {
      date: new Date(),
      subject: '',
      from: [{ address: from }],
    },
    raw: Buffer.from(`From: ${from}\r\n\r\nBody`),
  };
}

/**
 * A rspamd `/checkv2` response fixture. `authenticated: true` adds the
 * `R_DKIM_ALLOW` symbol, so `parseRspamdOutput` reports
 * `senderAuthenticated: true` - the signal `applyWhitelistAdjustment`/
 * `partitionByWhitelistFlag` gate the full whitelist discount and AI-skip on.
 */
function fixtureRspamdCheck({
  score = 5,
  required = 15,
  authenticated = false,
}: { score?: number; required?: number; authenticated?: boolean } = {}) {
  return {
    score,
    required_score: required,
    ...(authenticated ? { symbols: { R_DKIM_ALLOW: { score: -0.2 } } } : {}),
  };
}

interface BuildOptions {
  aiConfig?: Partial<AiConfig>;
  scanConfig?: Partial<ScanConfig>;
  rspamdConfig?: Partial<RspamdConfig>;
}

async function buildScanService(options: BuildOptions = {}): Promise<{
  scanService: InstanceType<typeof ScanService>;
  fakeRspamdGateway: { checkEmail: ReturnType<typeof vi.fn> };
  fakeAiGateway: { classifyEmail: ReturnType<typeof vi.fn> };
}> {
  const fakeRspamdGateway = { checkEmail: vi.fn() };
  const fakeAiGateway = { classifyEmail: vi.fn() };

  const module = await Test.createTestingModule({
    providers: [
      ScanService,
      PendingMessagesStep,
      RspamdCheckStep,
      AiClassificationStep,
      DispositionStep,
      SenderListLookupStep,
      AiFailureTracker,
      {
        provide: ScanConfig,
        useValue: { batchScanSize: 200, batchProcessSize: 10, ...options.scanConfig },
      },
      {
        provide: AiConfig,
        useValue: {
          enabled: false,
          concurrency: 5,
          maxInputTokens: 6000,
          maxOutputTokens: 200,
          failureAlertThreshold: 3,
          ...options.aiConfig,
        },
      },
      {
        provide: RspamdConfig,
        useValue: {
          url: 'http://localhost:11333',
          password: '',
          timeoutMs: 5000,
          envelopeTrustedHops: 0,
          ...options.rspamdConfig,
        },
      },
      { provide: RspamdGateway, useValue: fakeRspamdGateway },
      { provide: AiGateway, useValue: fakeAiGateway },
    ],
  }).compile();

  return {
    scanService: module.get(ScanService),
    fakeRspamdGateway,
    fakeAiGateway,
  };
}

describe('ScanService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReadScannerState.mockResolvedValue({
      last_uid: 100,
      last_seen_date: '',
      last_checked: '',
    });
    mockReadMapState.mockResolvedValue([]);
    mockWriteScannerState.mockResolvedValue(true);
    mockOpen.mockResolvedValue({ uidValidity: 1n, uidNext: 200 });
    mockMoveMessages.mockResolvedValue(undefined);
    mockUpdateLabels.mockResolvedValue(undefined);
  });

  test('a blacklisted sender is moved to spam without ever reaching rspamd or AI', async () => {
    const { scanService, fakeRspamdGateway } = await buildScanService();
    const session = fixtureSession();

    mockReadMapState.mockImplementation((imap, stateFolder, key) =>
      Promise.resolve(key === 'rspamd-blacklist-map' ? ['bad@evil.com'] : [])
    );
    mockSearch.mockResolvedValue([101, 102]);
    mockFetchMessagesByUIDs.mockResolvedValue([
      fixtureMessage({ uid: 101, from: 'bad@evil.com' }),
      fixtureMessage({ uid: 102, from: 'ok@example.com' }),
    ]);
    fakeRspamdGateway.checkEmail.mockResolvedValue({
      score: 5,
      required_score: 15,
    });

    await scanService.runScan(session);

    expect(fakeRspamdGateway.checkEmail).toHaveBeenCalledTimes(1); // only uid 102
    expect(mockMoveMessages).toHaveBeenCalledWith(
      session.imap,
      expect.arrayContaining([expect.objectContaining({ uid: 101 })]),
      session.folders.spam,
      session.logger
    );
  });

  describe('UID filter', () => {
    test('IMAP range inversion: search returns only lastUID, no messages are processed', async () => {
      const { scanService } = await buildScanService();
      const session = fixtureSession();
      mockReadScannerState.mockResolvedValue({
        last_uid: 7384,
        last_seen_date: '',
        last_checked: '',
      });
      mockSearch.mockResolvedValue([7384]); // server wraps 7385:* -> [7384]

      const result = await scanService.runScan(session);

      expect(mockFetchMessagesByUIDs).not.toHaveBeenCalled();
      expect(result).toEqual({ processed: 0, last_uid: 7384 });
    });

    test('normal case: search returns UIDs greater than lastUID, all are enqueued', async () => {
      const { scanService } = await buildScanService();
      const session = fixtureSession();
      const lastUID = 100;
      const newUIDs = [101, 102, 103];
      mockReadScannerState.mockResolvedValue({
        last_uid: lastUID,
        last_seen_date: '',
        last_checked: '',
      });
      mockSearch.mockResolvedValue(newUIDs);
      mockFetchMessagesByUIDs.mockResolvedValue(
        newUIDs.map(uid => fixtureMessage({ uid }))
      );

      const result = await scanService.runScan(session);

      expect(mockFetchMessagesByUIDs).toHaveBeenCalledWith(
        session.imap,
        newUIDs,
        session.logger
      );
      expect(result).toEqual({
        processed: newUIDs.length,
        last_uid: Math.max(...newUIDs),
      });
    });

    test('mixed case: search returns stale and new UIDs, only new ones are enqueued', async () => {
      const { scanService } = await buildScanService();
      const session = fixtureSession();
      const lastUID = 100;
      const newUIDs = [101, 102];
      mockReadScannerState.mockResolvedValue({
        last_uid: lastUID,
        last_seen_date: '',
        last_checked: '',
      });
      mockSearch.mockResolvedValue([lastUID, ...newUIDs]);
      mockFetchMessagesByUIDs.mockResolvedValue(
        newUIDs.map(uid => fixtureMessage({ uid }))
      );

      await scanService.runScan(session);

      expect(mockFetchMessagesByUIDs).toHaveBeenCalledWith(
        session.imap,
        newUIDs,
        session.logger
      );
    });
  });

  describe('last_uid advancement past permanently-skipped messages', () => {
    test('last_uid still advances past a message rspamd permanently rejected (4xx)', async () => {
      const { scanService, fakeRspamdGateway } = await buildScanService();
      const session = fixtureSession();
      mockReadScannerState.mockResolvedValue({
        last_uid: 100,
        last_seen_date: '',
        last_checked: '',
      });
      mockSearch.mockResolvedValue([101, 102]);
      mockFetchMessagesByUIDs.mockResolvedValue([
        fixtureMessage({ uid: 101 }),
        fixtureMessage({ uid: 102 }),
      ]);
      // uid 101's rspamd check is permanently rejected (4xx) - it never
      // gets spamInfo, but its UID must still count toward last_uid.
      let call = 0;
      fakeRspamdGateway.checkEmail.mockImplementation(async () => {
        call++;
        if (call === 1) {
          const err: Error & { status?: number } = new Error('bad request');
          err.status = 400;
          throw err;
        }
        return { score: 1, required_score: 15 };
      });

      await scanService.runScan(session);

      expect(mockWriteScannerState).toHaveBeenCalledWith(
        session.imap,
        session.folders.state,
        expect.objectContaining({ last_uid: 102 }),
        session.logger
      );
    });
  });

  describe('AI escalation wiring', () => {
    test('global AI_ENABLED=false: AI is never called', async () => {
      const { scanService, fakeRspamdGateway, fakeAiGateway } =
        await buildScanService({ aiConfig: { enabled: false } });
      const session = fixtureSession();
      mockSearch.mockResolvedValue([101]);
      mockFetchMessagesByUIDs.mockResolvedValue([fixtureMessage({ uid: 101 })]);
      fakeRspamdGateway.checkEmail.mockResolvedValue({
        score: 1,
        required_score: 15,
      }); // clean tier

      await scanService.runScan(session);

      expect(fakeAiGateway.classifyEmail).not.toHaveBeenCalled();
    });

    test('global AI_ENABLED=false + per-mailbox settings.aiEnabled=true: AI is still never called (opt-out can only turn AI off, never on)', async () => {
      const { scanService, fakeRspamdGateway, fakeAiGateway } =
        await buildScanService({ aiConfig: { enabled: false } });
      const session = fixtureSession({
        settings: { ...defaultMailboxSettings, aiEnabled: true },
      });
      mockSearch.mockResolvedValue([101]);
      mockFetchMessagesByUIDs.mockResolvedValue([fixtureMessage({ uid: 101 })]);
      fakeRspamdGateway.checkEmail.mockResolvedValue({
        score: 1,
        required_score: 15,
      }); // clean tier

      await scanService.runScan(session);

      expect(fakeAiGateway.classifyEmail).not.toHaveBeenCalled();
    });

    test("per-mailbox settings.aiEnabled=false: AI is never called even though the app-wide AiConfig is enabled", async () => {
      const { scanService, fakeRspamdGateway, fakeAiGateway } =
        await buildScanService({ aiConfig: { enabled: true } });
      const session = fixtureSession({
        settings: { ...defaultMailboxSettings, aiEnabled: false },
      });
      mockSearch.mockResolvedValue([101]);
      mockFetchMessagesByUIDs.mockResolvedValue([fixtureMessage({ uid: 101 })]);
      fakeRspamdGateway.checkEmail.mockResolvedValue({
        score: 1,
        required_score: 15,
      });

      await scanService.runScan(session);

      expect(fakeAiGateway.classifyEmail).not.toHaveBeenCalled();
    });

    test('AI enabled: a clean-tier message the AI scores high escalates to a spam-likelihood folder', async () => {
      const { scanService, fakeRspamdGateway, fakeAiGateway } =
        await buildScanService({ aiConfig: { enabled: true } });
      const session = fixtureSession({
        settings: {
          ...defaultMailboxSettings,
          processingMode: 'folder',
          aiEscalation: { toLowThreshold: 50, toHighThreshold: 80 },
        },
      });
      mockSearch.mockResolvedValue([101]);
      mockFetchMessagesByUIDs.mockResolvedValue([fixtureMessage({ uid: 101 })]);
      fakeRspamdGateway.checkEmail.mockResolvedValue({
        score: 1,
        required_score: 15,
      }); // clean tier from rspamd
      fakeAiGateway.classifyEmail.mockResolvedValue({
        score: 90,
        reasoning: 'looks like phishing',
      });

      await scanService.runScan(session);

      expect(mockMoveMessages).toHaveBeenCalledWith(
        session.imap,
        expect.arrayContaining([expect.objectContaining({ uid: 101 })]),
        session.folders.spamHigh,
        session.logger
      );
    });

    test('AI enabled: an authenticated whitelisted clean-tier message is never sent to AI and stays clean', async () => {
      const { scanService, fakeRspamdGateway, fakeAiGateway } =
        await buildScanService({ aiConfig: { enabled: true } });
      const session = fixtureSession({
        settings: { ...defaultMailboxSettings, processingMode: 'folder' },
      });
      mockReadMapState.mockImplementation((imap, stateFolder, key) =>
        Promise.resolve(
          key === 'rspamd-whitelist-map' ? ['trusted@example.com'] : []
        )
      );
      mockSearch.mockResolvedValue([101]);
      mockFetchMessagesByUIDs.mockResolvedValue([
        fixtureMessage({ uid: 101, from: 'trusted@example.com' }),
      ]);
      fakeRspamdGateway.checkEmail.mockResolvedValue(
        fixtureRspamdCheck({ score: 1, required: 15, authenticated: true })
      );

      await scanService.runScan(session);

      expect(fakeAiGateway.classifyEmail).not.toHaveBeenCalled();
      // Stays in a clean-tier outcome: never appears in the low-spam-folder move call.
      const lowSpamCall = mockMoveMessages.mock.calls.find(
        call => call[2] === session.folders.spamLow
      );
      expect(lowSpamCall?.[1]).toEqual([]);
    });

    test('AI enabled: an unauthenticated whitelisted clean-tier message is still sent to AI', async () => {
      const { scanService, fakeRspamdGateway, fakeAiGateway } =
        await buildScanService({ aiConfig: { enabled: true } });
      const session = fixtureSession({
        settings: { ...defaultMailboxSettings, processingMode: 'folder' },
      });
      mockReadMapState.mockImplementation((imap, stateFolder, key) =>
        Promise.resolve(
          key === 'rspamd-whitelist-map' ? ['trusted@example.com'] : []
        )
      );
      mockSearch.mockResolvedValue([101]);
      mockFetchMessagesByUIDs.mockResolvedValue([
        fixtureMessage({ uid: 101, from: 'trusted@example.com' }),
      ]);
      // No `symbols` - rspamd found no passing DKIM/DMARC, so the whitelist
      // match is untrusted and must not exempt this message from AI.
      fakeRspamdGateway.checkEmail.mockResolvedValue(
        fixtureRspamdCheck({ score: 1, required: 15 })
      );
      fakeAiGateway.classifyEmail.mockResolvedValue({
        score: 1,
        reasoning: 'fine',
      });

      await scanService.runScan(session);

      expect(fakeAiGateway.classifyEmail).toHaveBeenCalled();
    });
  });

  describe('UIDVALIDITY tracking', () => {
    test('mismatched uid_validity: resets to UIDNEXT - 1 instead of the stale last_uid', async () => {
      const { scanService } = await buildScanService();
      const session = fixtureSession();
      mockReadScannerState.mockResolvedValue({
        last_uid: 9000,
        last_seen_date: '',
        last_checked: '',
        uid_validity: '111',
      });
      // New epoch: server only has 5 messages now (UIDNEXT 6), nothing new yet.
      mockOpen.mockResolvedValue({ uidValidity: 222n, uidNext: 6 });
      mockSearch.mockResolvedValue([]);

      const result = await scanService.runScan(session);

      expect(mockFetchMessagesByUIDs).not.toHaveBeenCalled();
      expect(result).toEqual({ processed: 0, last_uid: 5 });
      // Persisted immediately even though nothing new was found, so the
      // next cycle doesn't re-detect the same mismatch and warn again.
      expect(mockWriteScannerState).toHaveBeenCalledWith(
        session.imap,
        session.folders.state,
        expect.objectContaining({ last_uid: 5, uid_validity: '222' }),
        session.logger
      );
    });
  });

  describe('processing mode', () => {
    test('an unknown processingMode throws', async () => {
      const { scanService, fakeRspamdGateway } = await buildScanService();
      const session = fixtureSession({
        settings: {
          ...defaultMailboxSettings,
          processingMode: 'invalid' as unknown as 'label' | 'folder',
        },
      });
      mockSearch.mockResolvedValue([101]);
      mockFetchMessagesByUIDs.mockResolvedValue([fixtureMessage({ uid: 101 })]);
      fakeRspamdGateway.checkEmail.mockResolvedValue({
        score: 1,
        required_score: 15,
      });

      await expect(scanService.runScan(session)).rejects.toThrow(
        'Unknown processing mode'
      );
    });
  });

  describe('batch processing', () => {
    test('processes UIDs in ScanConfig.batchProcessSize-sized batches', async () => {
      const { scanService, fakeRspamdGateway } = await buildScanService({
        scanConfig: { batchProcessSize: 2 },
      });
      const session = fixtureSession();
      const newUIDs = [101, 102, 103, 104, 105];
      mockSearch.mockResolvedValue(newUIDs);
      mockFetchMessagesByUIDs.mockImplementation((imap, uids) =>
        Promise.resolve(uids.map((uid: number) => fixtureMessage({ uid })))
      );
      fakeRspamdGateway.checkEmail.mockResolvedValue({
        score: 1,
        required_score: 15,
      });

      const result = await scanService.runScan(session);

      // 5 uids in batches of 2 -> 3 fetch calls (2, 2, 1)
      expect(mockFetchMessagesByUIDs).toHaveBeenCalledTimes(3);
      expect(result).toEqual({ processed: 5, last_uid: 105 });
    });
  });
});
