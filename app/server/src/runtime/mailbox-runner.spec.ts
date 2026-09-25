import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import pino from 'pino';
import { asImapFlow } from '../../test/support/imap-fakes.js';
import type { Mailbox } from '../infrastructure/mailboxes/mailbox.js';
import type { MailboxFolders } from '../infrastructure/imap/folder.resolver.js';
import type { MailboxSession } from '../application/mailbox-session.js';
import { ScanConfig } from '../config/app-config.js';
import { FolderInitService } from '../application/folders/folder-init.service.js';
import { RspamdTrainingService } from '../application/training/rspamd-training.service.js';
import { SenderListTrainingService } from '../application/training/sender-list-training.service.js';
import { ScanService } from '../application/scanning/scan.service.js';

const {
  mockNewClient,
  mockSafeLogout,
  mockResolveMailboxFolders,
  mockWaitForNewMail,
} = vi.hoisted(() => ({
  mockNewClient: vi.fn(),
  mockSafeLogout: vi.fn(),
  mockResolveMailboxFolders: vi.fn(),
  mockWaitForNewMail: vi.fn(),
}));

vi.mock('../infrastructure/imap/imap-connection.factory.js', () => ({
  newClient: mockNewClient,
  safeLogout: mockSafeLogout,
}));

vi.mock('../infrastructure/imap/folder.resolver.js', () => ({
  resolveMailboxFolders: mockResolveMailboxFolders,
}));

vi.mock('../infrastructure/imap/inbox.watcher.js', () => ({
  waitForNewMail: mockWaitForNewMail,
}));

// Imported after the mocks above, per this codebase's existing convention
// (see mailbox-loop.service.spec.ts) - `vi.mock` calls are hoisted above
// every import in this file regardless of where they're written.
import { MailboxRunner } from './mailbox-runner.js';

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

/**
 * A fake ImapFlow that satisfies `createMailboxSession`'s usable check.
 * `capabilities` defaults to an empty map (no `'IDLE'`) so a runner that
 * calls `start()` without overriding it lands in `'loop'` mode, matching the
 * class's own pre-`start()` default.
 */
function fixtureImap(
  overrides: {
    connect?: ReturnType<typeof vi.fn>;
    capabilities?: Map<string, boolean | number>;
  } = {},
) {
  return asImapFlow({
    usable: true,
    connect: overrides.connect ?? vi.fn().mockResolvedValue(undefined),
    capabilities: overrides.capabilities ?? new Map<string, boolean | number>(),
  });
}

/**
 * A real (but disabled) pino logger, so `createMailboxSession`'s `.child()`
 * call behaves exactly as it does in production - same technique as
 * `mailbox-session.spec.ts`/`mailbox-loop.service.spec.ts` - with `.error`
 * spied on so tests can assert a job failure was logged.
 */
function fixtureLogger(): pino.Logger {
  return pino({ enabled: false });
}

interface RunnerHandles {
  runner: MailboxRunner;
  mailbox: Mailbox;
  runSpam: ReturnType<typeof vi.fn>;
  runHam: ReturnType<typeof vi.fn>;
  runWhitelist: ReturnType<typeof vi.fn>;
  runBlacklist: ReturnType<typeof vi.fn>;
  runScan: ReturnType<typeof vi.fn>;
  initFolders: ReturnType<typeof vi.fn>;
  loggerError: ReturnType<typeof vi.spyOn>;
}

function buildRunner(
  options: {
    mailbox?: Mailbox;
    scanIntervalSeconds?: number;
    runSpam?: ReturnType<typeof vi.fn>;
    runHam?: ReturnType<typeof vi.fn>;
    runWhitelist?: ReturnType<typeof vi.fn>;
    runBlacklist?: ReturnType<typeof vi.fn>;
    runScan?: ReturnType<typeof vi.fn>;
    initFolders?: ReturnType<typeof vi.fn>;
  } = {},
): RunnerHandles {
  const mailbox = options.mailbox ?? fixtureMailbox();
  const runSpam = options.runSpam ?? vi.fn().mockResolvedValue(undefined);
  const runHam = options.runHam ?? vi.fn().mockResolvedValue(undefined);
  const runWhitelist =
    options.runWhitelist ?? vi.fn().mockResolvedValue(undefined);
  const runBlacklist =
    options.runBlacklist ?? vi.fn().mockResolvedValue(undefined);
  const runScan =
    options.runScan ?? vi.fn().mockResolvedValue({ processed: 0, last_uid: 0 });

  const initFolders = options.initFolders ?? vi.fn().mockResolvedValue(undefined);
  const folderInitService = { initFolders } as unknown as FolderInitService;
  const rspamdTrainingService = {
    runSpam,
    runHam,
  } as unknown as RspamdTrainingService;
  const senderListTrainingService = {
    runWhitelist,
    runBlacklist,
  } as unknown as SenderListTrainingService;
  const scanService = { runScan } as unknown as ScanService;
  const scanConfig = {
    scanIntervalSeconds: options.scanIntervalSeconds ?? 5,
    batchScanSize: 100,
    batchProcessSize: 100,
    maxRetries: 5,
  } as ScanConfig;
  const logger = fixtureLogger();
  const loggerError = vi.spyOn(logger, 'error');

  const runner = new MailboxRunner(
    mailbox,
    folderInitService,
    rspamdTrainingService,
    senderListTrainingService,
    scanService,
    scanConfig,
    logger,
  );

  return {
    runner,
    mailbox,
    runSpam,
    runHam,
    runWhitelist,
    runBlacklist,
    runScan,
    initFolders,
    loggerError,
  };
}

/** An `ImapFlow.capabilities` map that includes `'IDLE'` - task group 3's `start()` reads this to pick `mode: 'idle'`. */
function capabilitiesWithIdle(): Map<string, boolean | number> {
  return new Map([['IDLE', true]]);
}

/**
 * A `waitForNewMail` fake that stays pending until its `AbortSignal` fires -
 * mirrors the real function's own abort-resolves behavior
 * (`inbox.watcher.ts`) without ever firing an EXISTS notification, for tests
 * that need `start()`'s IDLE loop (task 3.3) to sit quietly in the
 * background without triggering a `scan` of its own, and to unwind cleanly
 * once `stop()` fires.
 */
function pendingWaitForNewMail(
  _imap: unknown,
  _folder: string,
  options?: { signal?: AbortSignal },
): Promise<void> {
  return new Promise<void>((resolve) => {
    if (options?.signal?.aborted) {
      resolve();
      return;
    }
    options?.signal?.addEventListener('abort', () => resolve(), {
      once: true,
    });
  });
}

describe('MailboxRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNewClient.mockImplementation(() => fixtureImap());
    mockSafeLogout.mockResolvedValue(undefined);
    mockResolveMailboxFolders.mockResolvedValue(fixtureFolders());
    mockWaitForNewMail.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // --- 2.2: session-per-job -------------------------------------------

  describe('session-per-job', () => {
    test("a job's fn receives a proper MailboxSession", async () => {
      let seenSession: MailboxSession | undefined;
      const runSpam = vi.fn().mockImplementation((session: MailboxSession) => {
        seenSession = session;
        return Promise.resolve();
      });
      const { runner, mailbox } = buildRunner({ runSpam });

      await runner.runTrainSpam();

      expect(mockNewClient).toHaveBeenCalledTimes(1);
      expect(mockResolveMailboxFolders).toHaveBeenCalledTimes(1);
      expect(seenSession).toBeDefined();
      expect(seenSession?.mailbox).toBe(mailbox);
      expect(seenSession?.folders).toEqual(fixtureFolders());
      expect(mockSafeLogout).toHaveBeenCalledTimes(1);
    });

    test('the session is closed via safeLogout in finally even when fn throws', async () => {
      const runSpam = vi.fn().mockRejectedValue(new Error('boom'));
      const { runner } = buildRunner({ runSpam });

      await runner.runTrainSpam();

      expect(mockSafeLogout).toHaveBeenCalledTimes(1);
    });
  });

  // --- 2.3 / 2.7: single-flight with coalescing, and stop() ------------

  describe('runJob single-flight and coalescing', () => {
    test('a second call while running does not start concurrently, and sets dirty instead', async () => {
      let resolveFirst!: () => void;
      const runSpam = vi.fn().mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirst = resolve;
          }),
      );
      const { runner } = buildRunner({ runSpam });

      const first = runner.runTrainSpam();
      // Give the first call a chance to open its session and reach
      // `status: 'running'`/call `fn` before the second call arrives.
      await vi.waitFor(() => expect(runSpam).toHaveBeenCalledTimes(1));
      const second = runner.runTrainSpam();

      // The second call returned without opening a second session - it just
      // marked the job dirty.
      expect(mockNewClient).toHaveBeenCalledTimes(1);

      resolveFirst();
      await first;
      await second;

      // The coalesced trigger produced exactly one extra run once the first
      // one finished.
      expect(runSpam).toHaveBeenCalledTimes(2);
    });

    test('three triggers arriving during one run produce exactly one extra run, not three and not zero', async () => {
      let resolveFirst!: () => void;
      const runSpam = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              resolveFirst = resolve;
            }),
        )
        .mockResolvedValue(undefined);
      const { runner } = buildRunner({ runSpam });

      const first = runner.runTrainSpam();
      await vi.waitFor(() => expect(runSpam).toHaveBeenCalledTimes(1));
      const second = runner.runTrainSpam();
      const third = runner.runTrainSpam();
      const fourth = runner.runTrainSpam();

      resolveFirst();
      await Promise.all([first, second, third, fourth]);

      expect(runSpam).toHaveBeenCalledTimes(2);
    });

    test('stop() set mid-coalesce stops the do/while from re-running (also covers 2.7)', async () => {
      let resolveFirst!: () => void;
      const runSpam = vi.fn().mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirst = resolve;
          }),
      );
      const { runner } = buildRunner({ runSpam });

      const first = runner.runTrainSpam();
      await vi.waitFor(() => expect(runSpam).toHaveBeenCalledTimes(1));
      const second = runner.runTrainSpam(); // marks dirty
      runner.stop();
      resolveFirst();
      await first;
      await second;

      // The pending coalesced run never happened because stop() fired first.
      expect(runSpam).toHaveBeenCalledTimes(1);
    });
  });

  // --- 2.4: attempt()/backoffMs() ---------------------------------------

  describe('attempt() backoff', () => {
    test('attempt() skips fn entirely and returns without calling it when still within the backoff window', async () => {
      vi.useFakeTimers();
      const runSpam = vi.fn().mockRejectedValue(new Error('rspamd down'));
      const { runner } = buildRunner({ runSpam });

      await runner.runTrainSpam(); // 1st failure -> backs off
      expect(runSpam).toHaveBeenCalledTimes(1);

      await runner.runTrainSpam(); // still within backoff window
      expect(runSpam).toHaveBeenCalledTimes(1);

      const status = runner.getStatus();
      expect(status.jobs.trainSpam.consecutiveFailures).toBe(1);
    });

    test('three consecutive failures produce a strictly increasing nextEligibleAt delay, each capped at 30 minutes', async () => {
      vi.useFakeTimers();
      const runSpam = vi.fn().mockRejectedValue(new Error('rspamd down'));
      const { runner } = buildRunner({ runSpam });

      const delays: number[] = [];
      for (let i = 0; i < 3; i++) {
        const before = Date.now();
        await runner.runTrainSpam();
        const status = runner.getStatus();
        const nextEligibleAt = status.jobs.trainSpam.nextEligibleAt;
        expect(nextEligibleAt).toBeDefined();
        const delay = new Date(nextEligibleAt as string).getTime() - before;
        delays.push(delay);
        // Advance well past this attempt's backoff before the next trigger.
        await vi.advanceTimersByTimeAsync(delay + 1);
      }

      expect(runSpam).toHaveBeenCalledTimes(3);
      expect(delays[0]).toBeLessThan(delays[1]);
      expect(delays[1]).toBeLessThan(delays[2]);
      for (const delay of delays) {
        expect(delay).toBeLessThanOrEqual(30 * 60 * 1000);
      }
    });

    test('a success after failures resets consecutiveFailures and nextEligibleAt to 0', async () => {
      vi.useFakeTimers();
      const runSpam = vi
        .fn()
        .mockRejectedValueOnce(new Error('rspamd down'))
        .mockResolvedValue(undefined);
      const { runner } = buildRunner({ runSpam });

      await runner.runTrainSpam(); // failure #1
      let status = runner.getStatus();
      const backoff =
        new Date(status.jobs.trainSpam.nextEligibleAt as string).getTime() -
        Date.now();
      await vi.advanceTimersByTimeAsync(backoff + 1);

      await runner.runTrainSpam(); // success
      status = runner.getStatus();
      expect(status.jobs.trainSpam.consecutiveFailures).toBe(0);
      expect(status.jobs.trainSpam.nextEligibleAt).toBeUndefined();
      expect(status.jobs.trainSpam.lastResult).toBe('success');
    });

    test('a connect failure thrown before the job body runs is recorded as an ordinary job failure', async () => {
      mockNewClient.mockImplementation(() =>
        fixtureImap({
          connect: vi.fn().mockRejectedValue(new Error('connect refused')),
        }),
      );
      const runSpam = vi.fn().mockResolvedValue(undefined);
      const { runner, loggerError } = buildRunner({ runSpam });

      await runner.runTrainSpam();

      // The job body itself never ran - the connection never came up.
      expect(runSpam).not.toHaveBeenCalled();
      const status = runner.getStatus();
      expect(status.jobs.trainSpam.consecutiveFailures).toBe(1);
      expect(status.jobs.trainSpam.lastResult).toBe('failure');
      expect(status.jobs.trainSpam.lastError).toBe('connect refused');
      expect(loggerError).toHaveBeenCalledTimes(1);
    });
  });

  // --- 2.5: triggerNow ----------------------------------------------------

  describe('triggerNow', () => {
    test('runs immediately even during backoff, and a subsequent success leaves consecutiveFailures at 0', async () => {
      vi.useFakeTimers();
      const runSpam = vi
        .fn()
        .mockRejectedValueOnce(new Error('rspamd down'))
        .mockResolvedValue(undefined);
      const { runner } = buildRunner({ runSpam });

      await runner.runTrainSpam(); // failure -> backs off for a while
      let status = runner.getStatus();
      expect(status.jobs.trainSpam.nextEligibleAt).toBeDefined();

      // Still well within the backoff window - an ordinary trigger would be
      // skipped, but triggerNow bypasses it.
      await runner.triggerNow('trainSpam');

      expect(runSpam).toHaveBeenCalledTimes(2);
      status = runner.getStatus();
      expect(status.jobs.trainSpam.consecutiveFailures).toBe(0);
      expect(status.jobs.trainSpam.nextEligibleAt).toBeUndefined();
    });
  });

  // --- 2.6: getStatus() -----------------------------------------------

  describe('getStatus()', () => {
    test('shape for a runner with one job mid-backoff: degraded, that job populated, others untouched', async () => {
      vi.useFakeTimers();
      const runSpam = vi.fn().mockRejectedValue(new Error('rspamd down'));
      const { runner, mailbox } = buildRunner({ runSpam });

      await runner.runTrainSpam();

      const status = runner.getStatus();
      expect(status.mailboxId).toBe(mailbox.id);
      expect(status.mode).toBe('loop');
      expect(status.state).toBe('degraded');
      expect(status.lastError).toBe('rspamd down');

      expect(status.jobs.trainSpam.consecutiveFailures).toBe(1);
      expect(status.jobs.trainSpam.lastResult).toBe('failure');
      expect(status.jobs.trainSpam.lastError).toBe('rspamd down');
      expect(status.jobs.trainSpam.lastRunAt).toBeDefined();
      expect(status.jobs.trainSpam.nextEligibleAt).toBeDefined();

      for (const job of [
        'scan',
        'trainHam',
        'trainWhitelist',
        'trainBlacklist',
      ] as const) {
        expect(status.jobs[job]).toEqual({
          lastRunAt: undefined,
          lastResult: undefined,
          lastError: undefined,
          consecutiveFailures: 0,
          nextEligibleAt: undefined,
        });
      }
    });
  });

  // --- 3.1: start() bootstrap + IDLE capability detection ----------------

  describe('start(): bootstrap and IDLE capability detection', () => {
    test("mode becomes 'idle' when the bootstrap connection advertises the IDLE capability", async () => {
      mockNewClient.mockImplementation(() =>
        fixtureImap({ capabilities: capabilitiesWithIdle() }),
      );
      mockWaitForNewMail.mockImplementation(pendingWaitForNewMail);
      const { runner, initFolders } = buildRunner();

      await runner.start();

      expect(initFolders).toHaveBeenCalledTimes(1);
      expect(runner.getStatus().mode).toBe('idle');

      runner.stop();
    });

    test("mode stays 'loop' when the bootstrap connection does not advertise the IDLE capability", async () => {
      mockNewClient.mockImplementation(() =>
        fixtureImap({ capabilities: new Map() }),
      );
      const { runner, initFolders } = buildRunner();

      await runner.start();

      expect(initFolders).toHaveBeenCalledTimes(1);
      expect(runner.getStatus().mode).toBe('loop');

      runner.stop();
    });

    test('the bootstrap connection is closed once folder init and the capability check finish', async () => {
      mockNewClient.mockImplementation(() =>
        fixtureImap({ capabilities: capabilitiesWithIdle() }),
      );
      mockWaitForNewMail.mockImplementation(pendingWaitForNewMail);
      const { runner } = buildRunner();

      await runner.start();

      // One logout for the bootstrap connection - the IDLE loop's own
      // dedicated connection (task 3.3) is separate and stays open.
      expect(mockSafeLogout).toHaveBeenCalledTimes(1);

      runner.stop();
    });

    test('a bootstrap failure is logged and start() resolves without throwing, and no loop starts', async () => {
      mockNewClient.mockImplementation(() =>
        fixtureImap({
          connect: vi.fn().mockRejectedValue(new Error('connect refused')),
        }),
      );
      const { runner, loggerError } = buildRunner();

      await expect(runner.start()).resolves.toBeUndefined();

      expect(loggerError).toHaveBeenCalledTimes(1);
      // Bootstrap's own failed connection attempt is the only one - neither
      // the interval nor an IDLE loop ever started a second connection.
      expect(mockNewClient).toHaveBeenCalledTimes(1);
      expect(runner.getStatus().mode).toBe('loop');
    });
  });

  // --- 3.2 / 3.5: the global interval, and D7's scan safety net -----------

  describe('the global interval (task 3.2)', () => {
    test("a loop-mode runner's tick calls all five jobs", async () => {
      vi.useFakeTimers();
      mockNewClient.mockImplementation(() =>
        fixtureImap({ capabilities: new Map() }),
      );
      const { runner, runSpam, runHam, runWhitelist, runBlacklist, runScan } =
        buildRunner({ scanIntervalSeconds: 5 });

      await runner.start();
      expect(runner.getStatus().mode).toBe('loop');

      await vi.advanceTimersByTimeAsync(5000);

      expect(runSpam).toHaveBeenCalledTimes(1);
      expect(runHam).toHaveBeenCalledTimes(1);
      expect(runWhitelist).toHaveBeenCalledTimes(1);
      expect(runBlacklist).toHaveBeenCalledTimes(1);
      expect(runScan).toHaveBeenCalledTimes(1);

      runner.stop();
    });

    /**
     * D7 resolution (see design.md's own internal tension, resolved against
     * the `mailbox-runtime` spec, which is unambiguous): "One global
     * interval drives training for every mailbox, and is a safety net for
     * scanning" states plainly that "For a mailbox using IMAP IDLE, this
     * same interval SHALL also trigger the scan job" - not "only when
     * `mode === 'loop'`". So the interval calls `runScan()` on every tick
     * unconditionally, regardless of `mode`; in `'idle'` mode this is what
     * catches a silently dead/stalled IDLE connection (this test pins down
     * the spec's own "The interval triggers a scan even while IDLE is
     * active" scenario). This is also task 3.5's safety-net test.
     */
    test("an idle-mode runner's tick still calls scan (the interval is a safety net for IDLE, D7/task 3.5)", async () => {
      vi.useFakeTimers();
      mockNewClient.mockImplementation(() =>
        fixtureImap({ capabilities: capabilitiesWithIdle() }),
      );
      // The dedicated IDLE connection never sees an EXISTS notification in
      // this test - any scan call counted below must have come from the
      // interval, not from IDLE.
      mockWaitForNewMail.mockImplementation(pendingWaitForNewMail);

      const { runner, runSpam, runHam, runWhitelist, runBlacklist, runScan } =
        buildRunner({ scanIntervalSeconds: 5 });

      await runner.start();
      expect(runner.getStatus().mode).toBe('idle');

      await vi.advanceTimersByTimeAsync(5000);

      expect(runSpam).toHaveBeenCalledTimes(1);
      expect(runHam).toHaveBeenCalledTimes(1);
      expect(runWhitelist).toHaveBeenCalledTimes(1);
      expect(runBlacklist).toHaveBeenCalledTimes(1);
      expect(runScan).toHaveBeenCalledTimes(1);

      runner.stop();
    });

    test('stop() clears the interval so no further tick fires', async () => {
      vi.useFakeTimers();
      mockNewClient.mockImplementation(() =>
        fixtureImap({ capabilities: new Map() }),
      );
      const { runner, runSpam } = buildRunner({ scanIntervalSeconds: 5 });

      await runner.start();
      await vi.advanceTimersByTimeAsync(5000);
      expect(runSpam).toHaveBeenCalledTimes(1);

      runner.stop();
      await vi.advanceTimersByTimeAsync(20000);

      expect(runSpam).toHaveBeenCalledTimes(1);
    });
  });

  // --- 3.3: the IDLE loop --------------------------------------------------

  describe('the IDLE loop (task 3.3)', () => {
    test('scan runs once per EXISTS resolution, and the loop exits cleanly on stop()', async () => {
      mockNewClient.mockImplementation(() =>
        fixtureImap({ capabilities: capabilitiesWithIdle() }),
      );
      mockWaitForNewMail
        .mockResolvedValueOnce(undefined) // 1st EXISTS
        .mockResolvedValueOnce(undefined) // 2nd EXISTS
        .mockImplementationOnce(pendingWaitForNewMail); // then sits idle

      const { runner, runScan } = buildRunner({
        scanIntervalSeconds: 999_999,
      });

      await runner.start();
      expect(runner.getStatus().mode).toBe('idle');

      await vi.waitFor(() => expect(runScan).toHaveBeenCalledTimes(2));
      await vi.waitFor(() =>
        expect(mockWaitForNewMail).toHaveBeenCalledTimes(3),
      );
      // waitForNewMail is always called against this mailbox's inbox folder.
      expect(mockWaitForNewMail.mock.calls[0]?.[1]).toBe('INBOX');

      runner.stop();

      // The pending (3rd) wait resolves via the abort signal `stop()` fires,
      // and the loop sees `stopped` and exits without an extra scan or a
      // reconnect attempt: 1 bootstrap connection + 1 dedicated IDLE
      // connection + one fresh session per `runScan()` call (design.md D4 -
      // each job opens/closes its own connection, including when triggered
      // by IDLE) = 4 connections total, each logged out exactly once.
      await vi.waitFor(() => expect(mockSafeLogout).toHaveBeenCalledTimes(4));
      expect(runScan).toHaveBeenCalledTimes(2);
      expect(mockNewClient).toHaveBeenCalledTimes(4);
    });
  });

  // --- 3.4: IDLE reconnect with backoff ------------------------------------

  describe('IDLE reconnect with backoff (task 3.4)', () => {
    test('a rejected waitForNewMail is retried after a backoff delay, with mode staying idle throughout', async () => {
      vi.useFakeTimers();
      mockNewClient.mockImplementation(() =>
        fixtureImap({ capabilities: capabilitiesWithIdle() }),
      );
      mockWaitForNewMail
        .mockRejectedValueOnce(new Error('connection reset'))
        .mockImplementation(pendingWaitForNewMail);

      const { runner } = buildRunner({ scanIntervalSeconds: 999_999 });

      await runner.start();
      expect(runner.getStatus().mode).toBe('idle');

      await vi.waitFor(() =>
        expect(mockWaitForNewMail).toHaveBeenCalledTimes(1),
      );
      // The dedicated IDLE connection opened once for that failed attempt,
      // on top of the bootstrap connection.
      expect(mockNewClient).toHaveBeenCalledTimes(2);

      // Still within backoffMs(1) === 2 ** 1 * 1000ms - no reconnect yet.
      await vi.advanceTimersByTimeAsync(1000);
      expect(mockNewClient).toHaveBeenCalledTimes(2);
      expect(runner.getStatus().mode).toBe('idle');

      // Cross the backoff window - the IDLE connection is re-opened.
      await vi.waitFor(() => expect(mockNewClient).toHaveBeenCalledTimes(3), {
        timeout: 5000,
      });
      await vi.waitFor(
        () => expect(mockWaitForNewMail).toHaveBeenCalledTimes(2),
        { timeout: 5000 },
      );

      expect(runner.getStatus().mode).toBe('idle');

      runner.stop();
    });
  });
});
