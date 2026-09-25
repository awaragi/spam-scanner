import { describe, test, expect, vi, beforeEach } from 'vitest';
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
import { AiFailureTracker } from '../domain/ai/ai-failure-tracker.js';

const {
  mockNewClient,
  mockSafeLogout,
  mockResolveMailboxFolders,
  mockReadSettingsOverrides,
  mockWriteSettingsOverrides,
} = vi.hoisted(() => ({
  mockNewClient: vi.fn(),
  mockSafeLogout: vi.fn(),
  mockResolveMailboxFolders: vi.fn(),
  mockReadSettingsOverrides: vi.fn(),
  mockWriteSettingsOverrides: vi.fn(),
}));

vi.mock('../infrastructure/imap/imap-connection.factory.js', () => ({
  newClient: mockNewClient,
  safeLogout: mockSafeLogout,
}));

vi.mock('../infrastructure/imap/folder.resolver.js', () => ({
  resolveMailboxFolders: mockResolveMailboxFolders,
}));

// `bootstrap()` (4-mailbox-settings-email design.md D4) now reads this
// mailbox's settings before folder resolution - mocked the same way as
// `mailbox-runner.spec.ts` so this file's fake IMAP client (which doesn't
// implement the real gateway methods this repository calls) is never
// actually touched. `updateSettings` (task group 4/D5) also writes overrides
// through this same module, so the mock object gains a
// `writeSettingsOverrides` entry rather than a second `vi.mock` call for the
// same module path.
vi.mock('../infrastructure/state/mailbox-settings.repository.js', () => ({
  readSettingsOverrides: mockReadSettingsOverrides,
  writeSettingsOverrides: mockWriteSettingsOverrides,
}));

// Imported after the mocks above, per this codebase's existing convention
// (see mailbox-runner.spec.ts) - `vi.mock` calls are hoisted above every
// import in this file regardless of where they're written.
import { RunnerRegistry } from './runner-registry.js';
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

/** A fake ImapFlow that satisfies `createMailboxSession`'s usable check. */
function fixtureImap(
  overrides: { connect?: ReturnType<typeof vi.fn> } = {},
) {
  return asImapFlow({
    usable: true,
    connect: overrides.connect ?? vi.fn().mockResolvedValue(undefined),
    capabilities: new Map<string, boolean | number>(),
  });
}

function fixtureBaseLogger(): pino.Logger {
  return pino({ enabled: false });
}

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

interface RegistryHandles {
  registry: RunnerRegistry;
  initFolders: ReturnType<typeof vi.fn>;
  pinoLoggerError: ReturnType<typeof vi.fn>;
  aiFailureTracker: AiFailureTracker;
}

async function buildRegistry(
  options: {
    mailboxes?: Mailbox[];
    scanIntervalSeconds?: number;
  } = {},
): Promise<RegistryHandles> {
  const mailboxes = options.mailboxes ?? [fixtureMailbox()];
  const initFolders = vi.fn().mockResolvedValue(undefined);
  const { pinoLogger, pinoLoggerError } = fixturePinoLogger();
  const aiFailureTracker = new AiFailureTracker();

  const moduleRef = await Test.createTestingModule({
    providers: [
      RunnerRegistry,
      { provide: MailboxRepository, useValue: { findAll: () => mailboxes } },
      {
        provide: ScanConfig,
        useValue: {
          scanIntervalSeconds: options.scanIntervalSeconds ?? 999_999,
          batchScanSize: 100,
          batchProcessSize: 100,
          maxRetries: 5,
        },
      },
      { provide: FolderInitService, useValue: { initFolders } },
      {
        provide: RspamdTrainingService,
        useValue: {
          runSpam: vi.fn().mockResolvedValue(undefined),
          runHam: vi.fn().mockResolvedValue(undefined),
        },
      },
      {
        provide: SenderListTrainingService,
        useValue: {
          runWhitelist: vi.fn().mockResolvedValue(undefined),
          runBlacklist: vi.fn().mockResolvedValue(undefined),
        },
      },
      {
        provide: ScanService,
        useValue: {
          runScan: vi.fn().mockResolvedValue({ processed: 0, last_uid: 0 }),
        },
      },
      { provide: PinoLogger, useValue: pinoLogger },
      { provide: AiFailureTracker, useValue: aiFailureTracker },
    ],
  }).compile();

  return {
    registry: moduleRef.get(RunnerRegistry),
    initFolders,
    pinoLoggerError,
    aiFailureTracker,
  };
}

describe('RunnerRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNewClient.mockImplementation(() => fixtureImap());
    mockSafeLogout.mockResolvedValue(undefined);
    mockResolveMailboxFolders.mockResolvedValue(fixtureFolders());
    mockReadSettingsOverrides.mockResolvedValue(undefined);
    mockWriteSettingsOverrides.mockResolvedValue(undefined);
  });

  // --- 4.1: independent per-mailbox bootstrap ---------------------------

  test("one mailbox's bootstrap failure does not block the other mailbox's runner from starting", async () => {
    const goodMailbox = fixtureMailbox({ id: 'good@example.com' });
    const badMailbox = fixtureMailbox({ id: 'bad@example.com' });

    mockNewClient.mockImplementation((mailbox: Mailbox) => {
      if (mailbox.id === badMailbox.id) {
        return fixtureImap({
          connect: vi.fn().mockRejectedValue(new Error('connect refused')),
        });
      }
      return fixtureImap();
    });

    const { registry } = await buildRegistry({
      mailboxes: [goodMailbox, badMailbox],
    });

    // The bad mailbox's bootstrap now retries forever with backoff
    // (`4-mailbox-settings-email` design.md D4), so its `start()` call never
    // resolves while it keeps failing. `onApplicationBootstrap` itself is
    // synchronous and fires every runner's `start()` without awaiting it
    // (exactly to avoid hanging on a permanently-unreachable mailbox), so the
    // runner map is populated the moment this call returns, and
    // `getStatus()`/`triggerNow()` are already usable regardless of whether
    // either runner's bootstrap has resolved yet - exactly the "does not
    // block" property this test exercises.
    registry.onApplicationBootstrap();

    const status = registry.getStatus();
    const mailboxIds = status.mailboxes.map((m) => m.mailboxId).sort();
    expect(mailboxIds).toEqual(['bad@example.com', 'good@example.com']);

    // The good mailbox's runner is up and can be triggered; the bad
    // mailbox's runner exists too (bootstrap failure just means its jobs
    // will fail until the mailbox recovers), but it did not throw or stop
    // the other mailbox's runner from being created and started.
    await expect(
      registry.triggerNow('good@example.com', 'trainSpam'),
    ).resolves.toBeUndefined();

    // Stop every runner, including the bad mailbox's still-retrying one, so
    // no real backoff timer is left pending once this test ends.
    registry.onApplicationShutdown();
  });

  // --- 4.2: getStatus() / triggerNow() -----------------------------------

  describe('getStatus()', () => {
    test('returns both the per-mailbox array and the top-level AI status field', async () => {
      const { registry, aiFailureTracker } = await buildRegistry();
      registry.onApplicationBootstrap();

      aiFailureTracker.recordFailure(new Error('rate limited'), 3);

      const status = registry.getStatus();

      expect(status.mailboxes).toHaveLength(1);
      expect(status.mailboxes[0]?.mailboxId).toBe('owner@example.com');
      expect(status.ai).toEqual({
        reason: expect.any(String) as string,
        count: 1,
        lastError: 'rate limited',
        lastAt: expect.any(String) as string,
      });
    });

    test("ai status reflects a fresh tracker's empty state when nothing has failed", async () => {
      const { registry } = await buildRegistry();
      registry.onApplicationBootstrap();

      const status = registry.getStatus();

      expect(status.ai).toEqual({
        reason: null,
        count: 0,
        lastError: null,
        lastAt: null,
      });
    });
  });

  describe('triggerNow()', () => {
    test('delegates to the matching mailbox runner', async () => {
      const mailbox = fixtureMailbox();
      const { registry } = await buildRegistry({ mailboxes: [mailbox] });
      registry.onApplicationBootstrap();

      // Assert delegation indirectly through the targeted runner's own
      // status update after triggering (no HTTP layer exists yet to
      // observe this through).
      await registry.triggerNow(mailbox.id, 'scan');

      const status = registry.getStatus();
      const mailboxStatus = status.mailboxes.find(
        (m) => m.mailboxId === mailbox.id,
      );
      expect(mailboxStatus?.jobs.scan.lastResult).toBe('success');
    });

    test('throws a clear error for an unknown mailboxId', async () => {
      const { registry } = await buildRegistry();
      registry.onApplicationBootstrap();

      await expect(
        registry.triggerNow('does-not-exist@example.com', 'scan'),
      ).rejects.toThrow('Unknown mailbox: does-not-exist@example.com');
    });
  });

  // --- 4.3: onApplicationShutdown() --------------------------------------

  describe('onApplicationShutdown()', () => {
    test('stops every constructed runner without throwing or hanging', async () => {
      const mailboxes = [
        fixtureMailbox({ id: 'a@example.com' }),
        fixtureMailbox({ id: 'b@example.com' }),
      ];
      const { registry } = await buildRegistry({ mailboxes });
      registry.onApplicationBootstrap();

      expect(() => {
        registry.onApplicationShutdown();
      }).not.toThrow();

      // Triggering after shutdown should still resolve normally - stop()
      // does not tear down the runner object itself, only its timers/flags.
      await expect(
        registry.triggerNow('a@example.com', 'trainSpam'),
      ).resolves.toBeUndefined();
    });
  });

  // --- 4.1/4.2/4.3: updateSettings() (design.md D5) -----------------------

  describe('updateSettings()', () => {
    test('a valid update stops the old runner, writes the new settings message, and replaces the map entry with a fresh runner using the new settings', async () => {
      const mailbox = fixtureMailbox();
      const { registry } = await buildRegistry({ mailboxes: [mailbox] });
      registry.onApplicationBootstrap();

      // Run a job on the pre-update runner so it accumulates observable
      // state (`lastResult`) a brand-new replacement runner would not have.
      await registry.triggerNow(mailbox.id, 'scan');
      expect(registry.getStatus().mailboxes[0]?.jobs.scan.lastResult).toBe(
        'success',
      );

      const stopSpy = vi.spyOn(MailboxRunner.prototype, 'stop');
      try {
        const overrides = { folders: { spam: 'INBOX.updated-spam' } };
        // The new runner's own bootstrap (fired but not awaited by
        // `updateSettings`, D5 step 6) re-reads settings from the state
        // folder - simulate that read now returning what was "just
        // written" so the new runner's resolved folders are observably
        // different from the old runner's defaults.
        mockReadSettingsOverrides.mockResolvedValue(overrides);

        await registry.updateSettings(mailbox.id, overrides);

        // Step 3: the existing runner was stopped.
        expect(stopSpy).toHaveBeenCalledTimes(1);

        // Step 4: the validated overrides were written against the
        // mailbox's own state folder.
        expect(mockWriteSettingsOverrides).toHaveBeenCalledWith(
          expect.anything(),
          mailbox.stateFolder,
          overrides,
          expect.anything(),
        );

        // Steps 5/6: the map entry now points at a brand-new runner with no
        // job history yet - a direct, observable difference from the old
        // runner's `lastResult` asserted above.
        expect(
          registry.getStatus().mailboxes[0]?.jobs.scan.lastResult,
        ).toBeUndefined();

        // The replacement runner's bootstrap used the newly written
        // settings, not the old runner's stale cached defaults.
        await vi.waitFor(() => {
          expect(mockResolveMailboxFolders).toHaveBeenCalledWith(
            expect.anything(),
            expect.objectContaining({ spam: 'INBOX.updated-spam' }),
          );
        });
      } finally {
        stopSpy.mockRestore();
      }
    });

    test('an invalid update (a recognized key with the wrong type) rejects without stopping or writing anything', async () => {
      const mailbox = fixtureMailbox();
      const { registry } = await buildRegistry({ mailboxes: [mailbox] });
      registry.onApplicationBootstrap();

      await registry.triggerNow(mailbox.id, 'scan');
      expect(registry.getStatus().mailboxes[0]?.jobs.scan.lastResult).toBe(
        'success',
      );

      const stopSpy = vi.spyOn(MailboxRunner.prototype, 'stop');
      try {
        await expect(
          registry.updateSettings(mailbox.id, {
            thresholds: { clean: 'not-a-number' },
          }),
        ).rejects.toThrow();

        expect(stopSpy).not.toHaveBeenCalled();
        expect(mockWriteSettingsOverrides).not.toHaveBeenCalled();

        // The original runner - and its already-accumulated job history -
        // is still the one in the map, unaffected by the rejected update.
        expect(
          registry.getStatus().mailboxes[0]?.jobs.scan.lastResult,
        ).toBe('success');
      } finally {
        stopSpy.mockRestore();
      }
    });

    test('rejects with the same "Unknown mailbox" error triggerNow uses, for an unknown mailboxId', async () => {
      const { registry } = await buildRegistry();
      registry.onApplicationBootstrap();

      await expect(
        registry.updateSettings('does-not-exist@example.com', {
          aiEnabled: false,
        }),
      ).rejects.toThrow('Unknown mailbox: does-not-exist@example.com');

      expect(mockWriteSettingsOverrides).not.toHaveBeenCalled();
    });

    test('a hand-edited settings message is overwritten completely, not merged, by the next update', async () => {
      const mailbox = fixtureMailbox();
      const { registry } = await buildRegistry({ mailboxes: [mailbox] });
      registry.onApplicationBootstrap();

      // Simulate a settings message that exists in the mailbox's state
      // folder because of a hand edit made directly, bypassing
      // `updateSettings` entirely - if anything read the state folder right
      // now, this is what it would find.
      const handEditedOverrides = { aiEnabled: false };
      mockReadSettingsOverrides.mockResolvedValue(handEditedOverrides);

      const secondOverrides = { thresholds: { clean: 12 } };
      await registry.updateSettings(mailbox.id, secondOverrides);

      // The write carries only this call's own validated overrides - never
      // merged with the hand-edited content already sitting in the state
      // folder, since `updateSettings` never reads-then-merges (design.md
      // D5).
      expect(mockWriteSettingsOverrides).toHaveBeenCalledWith(
        expect.anything(),
        mailbox.stateFolder,
        secondOverrides,
        expect.anything(),
      );
      expect(mockWriteSettingsOverrides).not.toHaveBeenCalledWith(
        expect.anything(),
        mailbox.stateFolder,
        expect.objectContaining(handEditedOverrides),
        expect.anything(),
      );
    });
  });
});
