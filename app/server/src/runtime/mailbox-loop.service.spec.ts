import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { Test } from '@nestjs/testing';
import pino from 'pino';
import { PinoLogger } from 'nestjs-pino';
import { asImapFlow } from '../../test/support/imap-fakes.js';
import type { Mailbox } from '../infrastructure/mailboxes/mailbox.js';
import type { MailboxFolders } from '../infrastructure/imap/folder.resolver.js';
import { MailboxRepository } from '../infrastructure/mailboxes/mailbox.repository.js';
import { ScanConfig } from '../config/app-config.js';
import { FolderInitService } from '../application/folders/folder-init.service.js';
import { RspamdTrainingService } from '../application/training/rspamd-training.service.js';
import { SenderListTrainingService } from '../application/training/sender-list-training.service.js';
import { ScanService } from '../application/scanning/scan.service.js';

const { mockNewClient, mockSafeLogout, mockResolveMailboxFolders } = vi.hoisted(
  () => ({
    mockNewClient: vi.fn(),
    mockSafeLogout: vi.fn(),
    mockResolveMailboxFolders: vi.fn(),
  }),
);

vi.mock('../infrastructure/imap/imap-connection.factory.js', () => ({
  newClient: mockNewClient,
  safeLogout: mockSafeLogout,
}));

vi.mock('../infrastructure/imap/folder.resolver.js', () => ({
  resolveMailboxFolders: mockResolveMailboxFolders,
}));

// Imported after the mocks above, per this codebase's existing convention
// (see rspamd-training.service.spec.ts) - `vi.mock` calls are hoisted above
// every import in this file regardless of where they're written.
import { MailboxLoopService } from './mailbox-loop.service.js';

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
  overrides: Partial<MailboxFolders> = {},
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

/** A fake ImapFlow that satisfies `createMailboxSession`'s usable check. */
function fixtureImap() {
  return asImapFlow({
    usable: true,
    connect: vi.fn().mockResolvedValue(undefined),
  });
}

/**
 * A real (but disabled) pino logger, so `createMailboxSession`'s `.child()`
 * call behaves exactly as it does in production - same technique as
 * `mailbox-session.spec.ts`.
 */
function fixtureBaseLogger(): pino.Logger {
  return pino({ enabled: false });
}

/**
 * `pinoLoggerError` is returned separately (rather than read back off
 * `pinoLogger.error`) purely so assertions reference a plain `vi.fn()`
 * rather than a `PinoLogger`-typed method - the latter trips oxlint's
 * `unbound-method` rule when passed to `expect(...)` unevaluated.
 */
function fixturePinoLogger(): {
  pinoLogger: PinoLogger;
  pinoLoggerError: ReturnType<typeof vi.fn>;
} {
  const pinoLoggerError = vi.fn();
  const pinoLogger = {
    logger: fixtureBaseLogger(),
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: pinoLoggerError,
    fatal: vi.fn(),
  } as unknown as PinoLogger;
  return { pinoLogger, pinoLoggerError };
}

interface ServiceHandles {
  service: InstanceType<typeof MailboxLoopService>;
  runSpam: ReturnType<typeof vi.fn>;
  runHam: ReturnType<typeof vi.fn>;
  runWhitelist: ReturnType<typeof vi.fn>;
  runBlacklist: ReturnType<typeof vi.fn>;
  runScan: ReturnType<typeof vi.fn>;
  initFolders: ReturnType<typeof vi.fn>;
  pinoLoggerError: ReturnType<typeof vi.fn>;
}

async function buildService(
  options: {
    mailbox?: Mailbox;
    mailboxes?: Mailbox[];
    scanIntervalSeconds?: number;
    runSpam?: ReturnType<typeof vi.fn>;
    runHam?: ReturnType<typeof vi.fn>;
    runWhitelist?: ReturnType<typeof vi.fn>;
    runBlacklist?: ReturnType<typeof vi.fn>;
    runScan?: ReturnType<typeof vi.fn>;
  } = {},
): Promise<ServiceHandles> {
  const mailbox = options.mailbox ?? fixtureMailbox();
  const mailboxes = options.mailboxes ?? [mailbox];
  const runSpam = options.runSpam ?? vi.fn().mockResolvedValue(undefined);
  const runHam = options.runHam ?? vi.fn().mockResolvedValue(undefined);
  const runWhitelist =
    options.runWhitelist ?? vi.fn().mockResolvedValue(undefined);
  const runBlacklist =
    options.runBlacklist ?? vi.fn().mockResolvedValue(undefined);
  const runScan =
    options.runScan ?? vi.fn().mockResolvedValue({ processed: 0, last_uid: 0 });
  const initFolders = vi.fn().mockResolvedValue(undefined);
  const { pinoLogger, pinoLoggerError } = fixturePinoLogger();

  const moduleRef = await Test.createTestingModule({
    providers: [
      MailboxLoopService,
      { provide: MailboxRepository, useValue: { findAll: () => mailboxes } },
      {
        provide: ScanConfig,
        useValue: {
          scanIntervalSeconds: options.scanIntervalSeconds ?? 5,
          batchScanSize: 100,
          batchProcessSize: 100,
          maxRetries: 5,
        },
      },
      { provide: FolderInitService, useValue: { initFolders } },
      {
        provide: RspamdTrainingService,
        useValue: { runSpam, runHam },
      },
      {
        provide: SenderListTrainingService,
        useValue: { runWhitelist, runBlacklist },
      },
      { provide: ScanService, useValue: { runScan } },
      { provide: PinoLogger, useValue: pinoLogger },
    ],
  }).compile();

  return {
    service: moduleRef.get(MailboxLoopService),
    runSpam,
    runHam,
    runWhitelist,
    runBlacklist,
    runScan,
    initFolders,
    pinoLoggerError,
  };
}

describe('MailboxLoopService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNewClient.mockImplementation(() => fixtureImap());
    mockSafeLogout.mockResolvedValue(undefined);
    mockResolveMailboxFolders.mockResolvedValue(fixtureFolders());
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('bootstrap runs folder init once, in its own session, before any tick starts', async () => {
    const { service, initFolders, runScan } = await buildService();

    await service.onApplicationBootstrap();

    expect(initFolders).toHaveBeenCalledTimes(1);
    // The bootstrap session was opened and closed before any tick fired.
    expect(mockNewClient).toHaveBeenCalledTimes(1);
    expect(mockSafeLogout).toHaveBeenCalledTimes(1);
    expect(runScan).not.toHaveBeenCalled();
  });

  test('a job rejecting during a tick is logged and the loop continues into the next tick', async () => {
    const runScan = vi
      .fn()
      .mockRejectedValueOnce(new Error('rspamd unreachable'))
      .mockResolvedValue({ processed: 0, last_uid: 10 });
    const { service, pinoLoggerError } = await buildService({
      runScan,
      scanIntervalSeconds: 5,
    });

    await service.onApplicationBootstrap();
    expect(runScan).not.toHaveBeenCalled();

    // First tick: runScan rejects - logged, not thrown.
    await vi.advanceTimersByTimeAsync(5000);
    expect(runScan).toHaveBeenCalledTimes(1);
    expect(pinoLoggerError).toHaveBeenCalledTimes(1);

    // Second tick: the loop is still running normally.
    await vi.advanceTimersByTimeAsync(5000);
    expect(runScan).toHaveBeenCalledTimes(2);
    // No new error logged for the successful second tick.
    expect(pinoLoggerError).toHaveBeenCalledTimes(1);
  });

  test('a failing job still closes its own IMAP connection', async () => {
    const runScan = vi.fn().mockRejectedValue(new Error('boom'));
    const { service } = await buildService({ runScan, scanIntervalSeconds: 5 });

    await service.onApplicationBootstrap();
    mockSafeLogout.mockClear();

    await vi.advanceTimersByTimeAsync(5000);

    // Each of the 4 training jobs opens and closes its own session, and the
    // one scan attempt (which fails) opens and closes its own session too -
    // 5 sessions closed, not 1 shared session for the whole tick.
    expect(mockSafeLogout).toHaveBeenCalledTimes(5);
  });

  test('each job in a normal tick opens and closes its own fresh session (not one shared session for the whole tick)', async () => {
    const { service } = await buildService({ scanIntervalSeconds: 5 });

    await service.onApplicationBootstrap();
    mockNewClient.mockClear();
    mockSafeLogout.mockClear();

    await vi.advanceTimersByTimeAsync(5000);

    // 4 training jobs (runSpam, runHam, runWhitelist, runBlacklist) + 1 scan
    // pass (the default fixture resolves processed: 0 on the first pass) =
    // 5 sessions opened and closed this tick, one per job.
    expect(mockNewClient).toHaveBeenCalledTimes(5);
    expect(mockSafeLogout).toHaveBeenCalledTimes(5);
  });

  test('a job throwing does not prevent the other jobs in the same tick from running', async () => {
    const runSpam = vi.fn().mockRejectedValue(new Error('rspamd unreachable'));
    const {
      service,
      runSpam: runSpamHandle,
      runHam,
      runWhitelist,
      runBlacklist,
      runScan,
      pinoLoggerError,
    } = await buildService({ runSpam, scanIntervalSeconds: 5 });

    await service.onApplicationBootstrap();

    await vi.advanceTimersByTimeAsync(5000);

    expect(runSpamHandle).toHaveBeenCalledTimes(1);
    // The rest of the tick's jobs still ran, even though runSpam threw.
    expect(runHam).toHaveBeenCalledTimes(1);
    expect(runWhitelist).toHaveBeenCalledTimes(1);
    expect(runBlacklist).toHaveBeenCalledTimes(1);
    expect(runScan).toHaveBeenCalledTimes(1);
    expect(pinoLoggerError).toHaveBeenCalledTimes(1);
  });

  test('shutdown requested mid-tick stops the remaining jobs in that same tick from starting', async () => {
    let serviceRef: { onApplicationShutdown(): void } | undefined;
    const runSpam = vi.fn().mockImplementation(async () => {
      serviceRef?.onApplicationShutdown();
    });
    const { service, runHam, runWhitelist, runBlacklist, runScan } =
      await buildService({ runSpam, scanIntervalSeconds: 5 });
    serviceRef = service;

    await service.onApplicationBootstrap();

    await vi.advanceTimersByTimeAsync(5000);

    expect(runSpam).toHaveBeenCalledTimes(1);
    // Shutdown fired between runSpam and runHam - none of the remaining jobs
    // in this tick should have started.
    expect(runHam).not.toHaveBeenCalled();
    expect(runWhitelist).not.toHaveBeenCalled();
    expect(runBlacklist).not.toHaveBeenCalled();
    expect(runScan).not.toHaveBeenCalled();
  });

  test('shutdown stops the timer: no further tick runs after onApplicationShutdown', async () => {
    const runScan = vi.fn().mockResolvedValue({ processed: 0, last_uid: 1 });
    const { service } = await buildService({ runScan, scanIntervalSeconds: 5 });

    await service.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(5000);
    expect(runScan).toHaveBeenCalledTimes(1);

    service.onApplicationShutdown();

    await vi.advanceTimersByTimeAsync(5000);
    expect(runScan).toHaveBeenCalledTimes(1);
  });

  test('scan-until-drained: runScan is called again while a pass still processes messages', async () => {
    const runScan = vi
      .fn()
      .mockResolvedValueOnce({ processed: 3, last_uid: 3 })
      .mockResolvedValueOnce({ processed: 2, last_uid: 5 })
      .mockResolvedValueOnce({ processed: 0, last_uid: 5 });
    const { service } = await buildService({ runScan, scanIntervalSeconds: 5 });

    await service.onApplicationBootstrap();
    await vi.advanceTimersByTimeAsync(5000);

    expect(runScan).toHaveBeenCalledTimes(3);
  });
});
