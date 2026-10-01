import {
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { MailboxRepository } from '../infrastructure/mailboxes/mailbox.repository.js';
import type { Mailbox } from '../infrastructure/mailboxes/mailbox.js';
import { ScanConfig } from '../config/app-config.js';
import { FolderInitService } from '../application/folders/folder-init.service.js';
import { RspamdTrainingService } from '../application/training/rspamd-training.service.js';
import { SenderListTrainingService } from '../application/training/sender-list-training.service.js';
import { ScanService } from '../application/scanning/scan.service.js';
import { AiFailureTracker } from 'shared/ai';
import { validateOverrides } from '../config/mailbox-settings.schema.js';
import type { MailboxSettings } from '../config/mailbox-settings.defaults.js';
import {
  newClient,
  safeLogout,
} from '../infrastructure/imap/imap-connection.factory.js';
import { writeSettingsOverrides } from '../infrastructure/state/mailbox-settings.repository.js';
import {
  MailboxRunner,
  type JobName,
  type MailboxRunnerStatus,
} from './mailbox-runner.js';

/**
 * The combined status shape `getStatus()` exposes - design.md D10. AI
 * classification is shared across every mailbox (one `AiGateway`, one
 * `AiFailureTracker`), so its status is a single top-level field, not folded
 * into any one mailbox's entry in `mailboxes`.
 */
export interface RunnerRegistryStatus {
  mailboxes: MailboxRunnerStatus[];
  ai: ReturnType<AiFailureTracker['status']>;
}

/**
 * The `@Injectable()`, `OnApplicationBootstrap`/`OnApplicationShutdown`
 * singleton that replaces the temporary run loop from
 * `2-nest-server-foundation` (design.md D1, Migration Plan): constructs one
 * `MailboxRunner` per `MailboxRepository.findAll()`
 * entry at bootstrap, keeps them keyed by mailbox id for status/trigger
 * lookups, and stops every one of them on shutdown.
 */
@Injectable()
export class RunnerRegistry
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  /** Every configured mailbox id → record, fixed at bootstrap. */
  private readonly mailboxes = new Map<string, Mailbox>();

  /** One active `MailboxRunner` per enabled mailbox id. */
  private readonly runners = new Map<string, MailboxRunner>();

  constructor(
    private readonly mailboxRepository: MailboxRepository,
    private readonly scanConfig: ScanConfig,
    private readonly folderInitService: FolderInitService,
    private readonly rspamdTrainingService: RspamdTrainingService,
    private readonly senderListTrainingService: SenderListTrainingService,
    private readonly scanService: ScanService,
    private readonly pinoLogger: PinoLogger,
    private readonly aiFailureTracker: AiFailureTracker,
  ) {}

  /**
   * Constructs one `MailboxRunner` per mailbox and starts each independently,
   * WITHOUT awaiting any runner's `start()` to completion.
   *
   * `4-mailbox-settings-email`'s D4 made `start()` retry its bootstrap
   * (connect + settings load + folder init) forever, with backoff, until it
   * succeeds - it only resolves once bootstrap has actually succeeded, or
   * once `stop()` is called. A mailbox that can never connect (bad
   * credentials, deleted account) therefore never resolves its `start()`
   * call. Awaiting every runner's `start()` via `Promise.all` before this
   * method returns would make `onApplicationBootstrap` - a real Nest
   * lifecycle hook - hang forever in that case, blocking the rest of the
   * application's startup. Each `start()` call is instead fired and
   * forgotten (`void runner.start()`), with a `.catch()` kept purely as a
   * defensive backstop (`start()` itself already resolves rather than
   * rejects on every failure it knows about) so an unexpected throw still
   * can't reach an unhandled rejection - matching design.md's "a failure in
   * one mailbox's runner SHALL NOT affect any other mailbox's runner, and
   * SHALL NOT stop the server process".
   */
  onApplicationBootstrap(): void {
    for (const mailbox of this.mailboxRepository.findAll()) {
      this.mailboxes.set(mailbox.id, mailbox);
      if (mailbox.enabled) {
        this.startRunner(mailbox);
      }
    }
  }

  /**
   * Stops a running mailbox's runner gracefully and removes it from the active
   * map. Idempotent when the mailbox is already disabled.
   */
  async disableMailbox(mailboxId: string): Promise<void> {
    if (!this.mailboxes.has(mailboxId)) {
      throw new Error(`Unknown mailbox: ${mailboxId}`);
    }
    const runner = this.runners.get(mailboxId);
    if (!runner) {
      return;
    }
    await runner.stop();
    this.runners.delete(mailboxId);
  }

  /**
   * Constructs and starts a fresh runner for a disabled mailbox. Idempotent
   * when the mailbox already has an active runner.
   */
  enableMailbox(mailboxId: string): void {
    const mailbox = this.mailboxes.get(mailboxId);
    if (!mailbox) {
      throw new Error(`Unknown mailbox: ${mailboxId}`);
    }
    if (this.runners.has(mailboxId)) {
      return;
    }
    this.startRunner(mailbox);
  }

  /**
   * Every mailbox's status plus the shared AI failure status - design.md
   * D10.
   */
  getStatus(): RunnerRegistryStatus {
    return {
      mailboxes: [...this.mailboxes.keys()]
        .sort()
        .map((mailboxId) => this.statusForMailbox(mailboxId)),
      ai: this.aiFailureTracker.status(),
    };
  }

  /**
   * Delegates to the named mailbox's runner - design.md D8, ready for
   * `5-server-api-auth` to expose over HTTP. An unknown `mailboxId` throws
   * rather than silently no-op'ing, so a future HTTP handler can translate
   * this into a 404 instead of returning a misleading 2xx for a mailbox that
   * does not exist.
   */
  async triggerNow(mailboxId: string, job: JobName): Promise<void> {
    const runner = this.requireRunner(mailboxId);
    await runner.triggerNow(job);
  }

  /**
   * The one mailbox's status - `5-server-api-auth` design.md D6, ready for
   * the mailbox API to expose over HTTP. Same "unknown mailbox throws"
   * contract as `triggerNow`.
   */
  getMailboxStatus(mailboxId: string): MailboxRunnerStatus {
    return this.statusForMailbox(mailboxId);
  }

  /**
   * The mailbox's currently resolved settings - `5-server-api-auth`
   * design.md D6. Same "unknown mailbox throws" contract as `triggerNow`.
   */
  getMailboxSettings(mailboxId: string): MailboxSettings {
    return this.requireRunner(mailboxId).getSettings();
  }

  /**
   * Runs folder initialization on demand for one mailbox - `5-server-api-auth`
   * design.md D6. Same "unknown mailbox throws" contract as `triggerNow`.
   */
  async triggerInitFolders(mailboxId: string): Promise<void> {
    await this.requireRunner(mailboxId).triggerInitFolders();
  }

  /**
   * Updates a mailbox's settings overrides - design.md D5's six-step
   * sequence. Validates first (`validateOverrides`, D2): a *type* error on a
   * recognized key throws here, before anything below runs - nothing is
   * stopped, nothing is written, and the existing runner and its cached
   * settings are left completely unaffected, per the spec's "An invalid
   * update is rejected without affecting the running mailbox" scenario. An
   * unrecognized/global-only key is dropped with a warning instead, and the
   * rest of the update proceeds.
   *
   * On a valid update: stops the existing runner and awaits that stop, so its
   * currently in-flight job (if any) finishes before anything else below
   * runs - `MailboxRunner.stop()`'s in-flight job is not forcibly aborted,
   * only prevented from re-running, so awaiting it here is what keeps the
   * old runner's last job and the new runner's first job from ever touching
   * the same mailbox concurrently. Then opens a throwaway IMAP connection to
   * write the validated overrides as a complete replacement of any previously
   * stored settings message - this call never
   * reads-then-merges the currently-stored message, so the spec's
   * "hand-edited settings message is overwritten, not merged" scenario falls
   * out of this for free - then constructs a brand-new `MailboxRunner` for
   * the same mailbox (D5's "Alternative considered": a fresh instance avoids
   * carrying the old runner's per-job backoff/failure history across an
   * unrelated settings change).
   *
   * Mirrors `onApplicationBootstrap`'s own "don't block on a runner's own
   * bootstrap resolving" principle (see that method's doc comment): the new
   * runner's `.start()` is fired but not awaited to completion - its
   * bootstrap retries with backoff (design.md D4) and may still be retrying
   * when this method returns. The map entry is replaced immediately once the
   * new runner is constructed, so `getStatus()`/`triggerNow()` calls arriving
   * during that retry see the new (possibly degraded) runner rather than the
   * stopped old one or nothing.
   */
  async updateSettings(
    mailboxId: string,
    overrides: Record<string, unknown>,
  ): Promise<void> {
    const existingRunner = this.requireRunner(mailboxId);

    // Step 2 (D5): throws (ZodError) on a type error against a recognized
    // key, before anything below runs. `overrides` is always a defined
    // object here (an update always provides something), so the result is
    // never `undefined` in practice - the `?? {}` below only satisfies
    // `validateOverrides`'s general `| undefined` return type.
    const validated =
      validateOverrides(overrides, this.pinoLogger.logger, mailboxId) ?? {};

    const mailbox = this.mailboxes.get(mailboxId);
    if (!mailbox) {
      throw new Error(`Unknown mailbox: ${mailboxId}`);
    }

    await existingRunner.stop();

    const imap = newClient(mailbox, this.pinoLogger.logger);
    try {
      await imap.connect();
      await writeSettingsOverrides(
        imap,
        mailbox.stateFolder,
        { ...validated },
        this.pinoLogger.logger,
      );
    } finally {
      await safeLogout(imap, this.pinoLogger.logger);
    }

    this.restartRunner(mailbox);
  }

  /**
   * Constructs a fresh `MailboxRunner` for `mailbox` and starts it
   * fire-and-forget (see `onApplicationBootstrap`'s doc comment on why
   * `start()` isn't awaited), replacing whatever runner the map currently
   * holds for its id. Shared by `updateSettings` and `withRunnerPaused` -
   * both stop an existing runner, do some external work, then need this
   * exact same "new instance, started, swapped into the map" sequence.
   */
  private restartRunner(mailbox: Mailbox): void {
    this.startRunner(mailbox);
  }

  private startRunner(mailbox: Mailbox): void {
    // `this.pinoLogger.logger` is ambient-context-aware: called while an
    // admin HTTP request is in flight (e.g. the enable-mailbox endpoint),
    // it would return a logger already bound to that one request's
    // metadata, which the runner would then keep on every log line for its
    // entire lifetime. `runInContext` (with the default `inherit: false`)
    // detaches from whatever request context is currently active and hands
    // back the plain root logger instead, matching the clean logger runners
    // already get when started at bootstrap (no request in flight there).
    const runnerLogger = this.pinoLogger.runInContext(
      () => this.pinoLogger.logger,
    );
    const newRunner = new MailboxRunner(
      mailbox,
      this.folderInitService,
      this.rspamdTrainingService,
      this.senderListTrainingService,
      this.scanService,
      this.scanConfig,
      runnerLogger,
    );
    void newRunner.start().catch((error: unknown) => {
      this.pinoLogger.error(
        {
          mailboxId: mailbox.id,
          error: error instanceof Error ? error.message : String(error),
        },
        'Unexpected error starting mailbox runner',
      );
    });
    this.runners.set(mailbox.id, newRunner);
  }

  private statusForMailbox(mailboxId: string): MailboxRunnerStatus {
    if (!this.mailboxes.has(mailboxId)) {
      throw new Error(`Unknown mailbox: ${mailboxId}`);
    }
    const runner = this.runners.get(mailboxId);
    if (!runner) {
      return { mailboxId, enabled: false };
    }
    return { enabled: true, ...runner.getStatus() };
  }

  private requireRunner(mailboxId: string): MailboxRunner {
    if (!this.mailboxes.has(mailboxId)) {
      throw new Error(`Unknown mailbox: ${mailboxId}`);
    }
    const runner = this.runners.get(mailboxId);
    if (!runner) {
      throw new Error(`Unknown mailbox: ${mailboxId}`);
    }
    return runner;
  }

  /**
   * Stops the mailbox's runner, runs `fn`, then always starts a fresh
   * runner for it - even when `fn` throws, so a failed external write never
   * leaves the mailbox with no active runner. For coordinating an external
   * IMAP write against the same per-mailbox state folder the runner's own
   * jobs read and write on their own connection (`MailboxAdminService`'s
   * `writeState`/`deleteState`/`replaceList` - without this, an admin write
   * racing a live scan/train job's own state write could silently lose one
   * of the two writes). Mirrors `updateSettings`'s own stop-then-restart
   * shape, generalized over what happens in between. Same "unknown mailbox
   * throws" contract as `triggerNow`.
   */
  async withRunnerPaused<T>(
    mailboxId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const existingRunner = this.requireRunner(mailboxId);
    const mailbox = this.mailboxes.get(mailboxId);
    if (!mailbox) {
      throw new Error(`Unknown mailbox: ${mailboxId}`);
    }

    await existingRunner.stop();
    try {
      return await fn();
    } finally {
      this.restartRunner(mailbox);
    }
  }

  /**
   * Stops every constructed runner - design.md D9. No in-flight job is
   * forcibly aborted; each `MailboxRunner.stop()` only prevents new/coalesced
   * job runs and closes its own timers/IDLE loop, per that method's own
   * contract. Awaits every runner's `stop()` so the process does not exit
   * mid-job.
   */
  async onApplicationShutdown(): Promise<void> {
    await Promise.all(
      [...this.runners.values()].map((runner) => runner.stop()),
    );
  }
}
