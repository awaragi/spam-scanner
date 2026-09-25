import type { ImapFlow } from 'imapflow';
import type { Logger as PinoLoggerLike } from 'pino';
import type { Mailbox } from '../infrastructure/mailboxes/mailbox.js';
import { ScanConfig } from '../config/app-config.js';
import {
  defaultMailboxSettings,
  resolveMailboxSettings,
  type MailboxSettings,
} from '../config/mailbox-settings.defaults.js';
import { validateOverrides } from '../config/mailbox-settings.schema.js';
import {
  newClient,
  safeLogout,
} from '../infrastructure/imap/imap-connection.factory.js';
import {
  resolveMailboxFolders,
  type MailboxFolders,
} from '../infrastructure/imap/folder.resolver.js';
import { waitForNewMail } from '../infrastructure/imap/inbox.watcher.js';
import { readSettingsOverrides } from '../infrastructure/state/mailbox-settings.repository.js';
import {
  createMailboxSession,
  type MailboxSession,
} from '../application/mailbox-session.js';
import { FolderInitService } from '../application/folders/folder-init.service.js';
import { RspamdTrainingService } from '../application/training/rspamd-training.service.js';
import { SenderListTrainingService } from '../application/training/sender-list-training.service.js';
import { ScanService } from '../application/scanning/scan.service.js';

/**
 * The five independently-triggerable jobs a `MailboxRunner` runs for its
 * mailbox - see design.md D1.
 */
export type JobName =
  | 'scan'
  | 'trainSpam'
  | 'trainHam'
  | 'trainWhitelist'
  | 'trainBlacklist';

/**
 * Per-job state a `MailboxRunner` tracks independently for each `JobName` -
 * see design.md D1. Deliberately one of these per job rather than one shared
 * state for the whole mailbox: a rspamd outage backs off `scan`/`trainSpam`/
 * `trainHam` without stalling `trainWhitelist`/`trainBlacklist`, which never
 * call rspamd.
 */
export interface JobState {
  status: 'idle' | 'running';
  /** A trigger fired while this job was already running - run once more. */
  dirty: boolean;
  consecutiveFailures: number;
  /** Epoch ms; 0 = eligible now. */
  nextEligibleAt: number;
  lastRunAt?: number;
  lastResult?: 'success' | 'failure';
  lastError?: string;
}

const JOB_NAMES: readonly JobName[] = [
  'scan',
  'trainSpam',
  'trainHam',
  'trainWhitelist',
  'trainBlacklist',
];

function createJobState(): JobState {
  return {
    status: 'idle',
    dirty: false,
    consecutiveFailures: 0,
    nextEligibleAt: 0,
  };
}

/**
 * `2 ** failures` seconds, capped at 30 minutes - see design.md D3 for the
 * reasoning behind the cap.
 */
function backoffMs(failures: number): number {
  return Math.min(2 ** failures * 1000, 30 * 60 * 1000);
}

/** One job's status, as exposed by `getStatus()` - see design.md D5. */
export interface JobStatus {
  /** ISO timestamp. */
  lastRunAt?: string;
  lastResult?: 'success' | 'failure';
  lastError?: string;
  consecutiveFailures: number;
  /** ISO timestamp, only present while this job is backing off. */
  nextEligibleAt?: string;
}

/** A mailbox's overall runner status, as exposed by `getStatus()` - see design.md D5. */
export interface MailboxRunnerStatus {
  mailboxId: string;
  /**
   * Derived: `'degraded'` iff any job has `consecutiveFailures > 0`, or this
   * mailbox has never once bootstrapped successfully
   * (`bootstrapFailures > 0` - `4-mailbox-settings-email` design.md D4).
   */
  state: 'running' | 'degraded';
  /** Which trigger mode this mailbox is in - see design.md D6 (set by `start()`, task 3). */
  mode: 'idle' | 'loop';
  /** The most recent failure across all jobs, if any. */
  lastError?: string;
  jobs: Record<JobName, JobStatus>;
}

/**
 * Runs every job (training, scanning) for exactly one mailbox: per-job
 * single-flight-with-coalescing (design.md D2), per-job degraded/backoff
 * (design.md D3), a session opened and closed fresh for every job run
 * (design.md D4, ported unchanged from `mailbox-loop.service.ts`'s
 * `openSession`), and an on-demand `triggerNow` ready for
 * `5-server-api-auth` to eventually call (design.md D8).
 *
 * Deliberately not `@Injectable()` - one `MailboxRunner` is constructed per
 * mailbox by `RunnerRegistry` (task group 4), not a DI singleton.
 *
 * `start()` (task group 3) is what wires the global interval and the
 * IDLE-first trigger loop on top of the job-execution core built here; this
 * class exposes `mode` (defaulting to `'loop'`) purely so `getStatus()` has
 * something to read until `start()` exists to set it properly.
 */
export class MailboxRunner {
  private readonly jobs: Record<JobName, JobState> = {
    scan: createJobState(),
    trainSpam: createJobState(),
    trainHam: createJobState(),
    trainWhitelist: createJobState(),
    trainBlacklist: createJobState(),
  };

  /** Set by `stop()`; checked by `runJob`'s `do/while` before every re-run (design.md D2/D9). */
  private stopped = false;

  /**
   * Which trigger mode this mailbox is in - set once by `start()`'s bootstrap
   * capability check and never changed again for the runner's lifetime
   * (design.md D6). Defaults to `'loop'` so `getStatus()` has something to
   * read before `start()` runs.
   */
  private mode: 'idle' | 'loop' = 'loop';

  /** The most recent failure across all jobs, for the mailbox-level status field (design.md D5). */
  private lastError: string | undefined;

  /** The global training/scan-safety-net timer `start()` creates (design.md D7); cleared by `stop()`. */
  private intervalTimer: NodeJS.Timeout | undefined;

  /**
   * Aborts a pending `waitForNewMail` wait or IDLE-reconnect backoff sleep so
   * `stop()` makes the IDLE loop (task 3.3) exit promptly instead of hanging
   * inside a wait that would otherwise only resolve on its own.
   */
  private readonly idleAbortController = new AbortController();

  /**
   * Consecutive failures of the dedicated IDLE connection itself (opening it,
   * or `waitForNewMail` throwing) - separate from `JobState`'s per-job
   * counters (design.md D1), since holding/re-establishing the IDLE
   * connection is not one of the five jobs (design.md D6/task 3.4).
   */
  private idleFailureCount = 0;

  /**
   * This mailbox's resolved settings - code defaults merged with any stored
   * override (`4-mailbox-settings-email` design.md D3/D4). Starts as
   * `defaultMailboxSettings` so `getStatus()`/any pre-bootstrap access never
   * sees `undefined`, and is only ever reassigned once per successful
   * `bootstrap()` - read once per runner lifetime and cached, never re-read
   * on every job run.
   */
  private settings: MailboxSettings = defaultMailboxSettings;

  /**
   * Consecutive `bootstrap()` failures - separate from both `JobState`'s
   * per-job counters and `idleFailureCount`, since bootstrap (connect +
   * settings load + folder init) is not one of the five jobs and has exactly
   * one caller (`start()`'s own retry loop, design.md D4).
   */
  private bootstrapFailures = 0;

  constructor(
    private readonly mailbox: Mailbox,
    // Used by the bootstrap `start()` method task group 3 adds, not by any
    // job body built here - accepted now so the constructor shape doesn't
    // need to change when `start()` lands.
    private readonly folderInitService: FolderInitService,
    private readonly rspamdTrainingService: RspamdTrainingService,
    private readonly senderListTrainingService: SenderListTrainingService,
    private readonly scanService: ScanService,
    private readonly scanConfig: ScanConfig,
    private readonly logger: PinoLoggerLike,
  ) {}

  /**
   * Opens one fresh `MailboxSession`: connects a new IMAP client, resolves
   * this mailbox's folders against the server's real delimiter, and
   * assembles the session around `this.settings` - the settings `bootstrap()`
   * resolved (once) and cached, per `4-mailbox-settings-email` design.md D4.
   * Ported unchanged in shape from `mailbox-loop.service.ts`'s `openSession`
   * - the caller is responsible for closing `session.imap` (via
   * `safeLogout`) once its job is done.
   */
  private async openSession(mailbox: Mailbox): Promise<MailboxSession> {
    const imap: ImapFlow = newClient(mailbox, this.logger);
    await imap.connect();
    const folders = await resolveMailboxFolders(imap, {
      ...this.settings.folders,
      state: mailbox.stateFolder,
    });
    return createMailboxSession({
      mailbox,
      imap,
      settings: this.settings,
      folders,
      logger: this.logger,
    });
  }

  /**
   * Single-flight-with-coalescing wrapper - exactly design.md D2. Every
   * trigger (interval tick, IDLE `EXISTS`, on-demand call) goes through this:
   * never concurrent for the same job (the `status === 'running'` guard),
   * never dropped (`dirty = true` before returning), never queued N times
   * (`dirty` is a boolean, not a counter).
   */
  private async runJob(job: JobName, fn: () => Promise<void>): Promise<void> {
    const state = this.jobs[job];
    if (state.status === 'running') {
      state.dirty = true;
      return;
    }
    state.status = 'running';
    do {
      state.dirty = false;
      await this.attempt(job, fn);
    } while (state.dirty && !this.stopped);
    state.status = 'idle';
  }

  /**
   * One real attempt at a job, with degraded/backoff bookkeeping - exactly
   * design.md D3. Skips `fn` entirely (silently) while still within this
   * job's backoff window. A thrown error - whether from `fn`'s own body or
   * from the session's IMAP connect failing before `fn`'s body even runs
   * (design.md D4) - is recorded identically as this job's failure.
   */
  private async attempt(job: JobName, fn: () => Promise<void>): Promise<void> {
    const state = this.jobs[job];
    if (Date.now() < state.nextEligibleAt) return;
    try {
      await fn();
      state.consecutiveFailures = 0;
      state.nextEligibleAt = 0;
      state.lastResult = 'success';
      state.lastError = undefined;
    } catch (err) {
      state.consecutiveFailures++;
      state.nextEligibleAt = Date.now() + backoffMs(state.consecutiveFailures);
      state.lastResult = 'failure';
      state.lastError = err instanceof Error ? err.message : String(err);
      this.lastError = state.lastError;
      this.logger.error(
        { mailboxId: this.mailbox.id, job, error: state.lastError },
        'Job failed',
      );
    }
    state.lastRunAt = Date.now();
  }

  /**
   * Runs `job` inside its own fresh `MailboxSession` via `runJob`/`attempt`,
   * closing the session in `finally` - the session-per-job shape design.md
   * D4 ports unchanged from `mailbox-loop.service.ts`. Mirrors that file's
   * own `runJob` helper: `session` is declared outside the `try` and only
   * assigned once `openSession` actually succeeds, so a connect failure
   * (which throws before `session` is ever assigned) does not attempt to log
   * out a session that was never opened.
   */
  private async runWithSession(
    job: JobName,
    work: (session: MailboxSession) => Promise<void>,
  ): Promise<void> {
    await this.runJob(job, async () => {
      let session: MailboxSession | undefined;
      try {
        session = await this.openSession(this.mailbox);
        await work(session);
      } finally {
        if (session) {
          await safeLogout(session.imap, session.logger);
        }
      }
    });
  }

  /** Runs one scan pass for this mailbox, in its own session. */
  async runScan(): Promise<void> {
    await this.runWithSession('scan', async (session) => {
      await this.scanService.runScan(session);
    });
  }

  /** Runs rspamd spam training for this mailbox, in its own session. */
  async runTrainSpam(): Promise<void> {
    await this.runWithSession('trainSpam', (session) =>
      this.rspamdTrainingService.runSpam(session),
    );
  }

  /** Runs rspamd ham training for this mailbox, in its own session. */
  async runTrainHam(): Promise<void> {
    await this.runWithSession('trainHam', (session) =>
      this.rspamdTrainingService.runHam(session),
    );
  }

  /** Runs whitelist sender-list training for this mailbox, in its own session. */
  async runTrainWhitelist(): Promise<void> {
    await this.runWithSession('trainWhitelist', (session) =>
      this.senderListTrainingService.runWhitelist(session),
    );
  }

  /** Runs blacklist sender-list training for this mailbox, in its own session. */
  async runTrainBlacklist(): Promise<void> {
    await this.runWithSession('trainBlacklist', (session) =>
      this.senderListTrainingService.runBlacklist(session),
    );
  }

  /** Dispatches a `JobName` to its concrete job-wrapper method, for `triggerNow`. */
  private runNamedJob(job: JobName): Promise<void> {
    switch (job) {
      case 'scan':
        return this.runScan();
      case 'trainSpam':
        return this.runTrainSpam();
      case 'trainHam':
        return this.runTrainHam();
      case 'trainWhitelist':
        return this.runTrainWhitelist();
      case 'trainBlacklist':
        return this.runTrainBlacklist();
    }
  }

  /**
   * On-demand trigger, ready for `5-server-api-auth` to call later - design.md
   * D8. Resets `job`'s `consecutiveFailures`/`nextEligibleAt` to 0 first, so
   * `runJob` (via `attempt`'s backoff check) runs it immediately even if the
   * job was still within its backoff window.
   */
  async triggerNow(job: JobName): Promise<void> {
    const state = this.jobs[job];
    state.consecutiveFailures = 0;
    state.nextEligibleAt = 0;
    await this.runNamedJob(job);
  }

  /**
   * This mailbox's current status - design.md D5. `state` and `lastError`
   * are derived from the per-job state, never tracked separately.
   */
  getStatus(): MailboxRunnerStatus {
    const jobs = {} as Record<JobName, JobStatus>;
    let degraded = false;

    for (const job of JOB_NAMES) {
      const state = this.jobs[job];
      if (state.consecutiveFailures > 0) {
        degraded = true;
      }
      jobs[job] = {
        lastRunAt:
          state.lastRunAt !== undefined
            ? new Date(state.lastRunAt).toISOString()
            : undefined,
        lastResult: state.lastResult,
        lastError: state.lastError,
        consecutiveFailures: state.consecutiveFailures,
        nextEligibleAt:
          state.nextEligibleAt > 0
            ? new Date(state.nextEligibleAt).toISOString()
            : undefined,
      };
    }

    return {
      mailboxId: this.mailbox.id,
      state: degraded || this.bootstrapFailures > 0 ? 'degraded' : 'running',
      mode: this.mode,
      lastError: this.lastError,
      jobs,
    };
  }

  /**
   * Bootstraps this mailbox: connects a fresh IMAP client, loads and caches
   * this mailbox's settings, resolves its folders against those settings,
   * builds a `MailboxSession` around them, runs `folderInitService.
   * initFolders` once, and - only on success - checks `imap.capabilities.
   * has('IDLE')` on that same connection before closing it, recording the
   * result as `this.mode` for the runner's lifetime (design.md D6).
   * Per `4-mailbox-settings-email` design.md D4, settings load happens
   * *before* folder resolution (not after), since folder resolution is
   * itself parameterized by `this.settings.folders`. Ported from
   * `mailbox-loop.service.ts`'s `bootstrapMailbox`.
   *
   * A connect failure, a `validateOverrides` type-error throw, or
   * `initFolders` throwing is logged and swallowed - `start()`'s retry loop
   * (design.md D4) is what keeps calling this again with backoff, so a
   * caller starting several mailboxes' runners (`RunnerRegistry`, task group
   * 4) is never short-circuited by one mailbox's bootstrap failing, and a
   * mailbox that can't yet bootstrap isn't abandoned forever.
   *
   * @returns This mailbox's resolved folders on success (used by `start()`
   *   to arm the IDLE loop against the right inbox folder), or `undefined`
   *   on bootstrap failure.
   */
  private async bootstrap(): Promise<{ folders: MailboxFolders } | undefined> {
    let imap: ImapFlow | undefined;
    try {
      imap = newClient(this.mailbox, this.logger);
      await imap.connect();

      const rawOverrides = await readSettingsOverrides(
        imap,
        this.mailbox.stateFolder,
        this.logger,
      );
      this.settings = resolveMailboxSettings(
        validateOverrides(rawOverrides, this.logger, this.mailbox.id),
      );

      const folders = await resolveMailboxFolders(imap, {
        ...this.settings.folders,
        state: this.mailbox.stateFolder,
      });
      const session = createMailboxSession({
        mailbox: this.mailbox,
        imap,
        settings: this.settings,
        folders,
        logger: this.logger,
      });
      await this.folderInitService.initFolders(session);

      this.mode = imap.capabilities.has('IDLE') ? 'idle' : 'loop';
      this.bootstrapFailures = 0;
      return { folders };
    } catch (error) {
      this.bootstrapFailures++;
      this.logger.error(
        {
          mailboxId: this.mailbox.id,
          error: error instanceof Error ? error.message : String(error),
        },
        'Mailbox bootstrap (connect + settings + folder init) failed',
      );
      return undefined;
    } finally {
      if (imap) {
        await safeLogout(imap, this.logger);
      }
    }
  }

  /**
   * Starts the global interval (design.md D7): every `scanConfig.
   * scanIntervalSeconds`, runs all four training jobs, and - per the
   * `mailbox-runtime` spec's "one global interval ... is a safety net for
   * scanning" requirement - `scan` too, unconditionally, regardless of
   * `mode`. This is deliberate: in `'idle'` mode this is what catches a
   * silently dead/stalled IDLE connection (the spec's own "The interval
   * triggers a scan even while IDLE is active" scenario); in `'loop'` mode
   * the interval is `scan`'s only trigger at all. `runJob`'s own
   * single-flight/coalescing (design.md D2) and backoff (D3) make an extra
   * `scan` trigger on top of IDLE cheap - if IDLE already drained the inbox,
   * this tick's `scan` just finds nothing new.
   */
  private startInterval(): void {
    const intervalMs = this.scanConfig.scanIntervalSeconds * 1000;
    this.intervalTimer = setInterval(() => {
      if (this.stopped) return;
      void this.runIntervalTick();
    }, intervalMs);
  }

  /**
   * One interval tick: the four training jobs, then `scan` - always, per
   * `startInterval`'s doc above. `this.stopped` is checked before every job,
   * not just once per tick (design.md D9), so a shutdown requested mid-tick
   * stops the remaining jobs in that tick from starting too.
   */
  private async runIntervalTick(): Promise<void> {
    if (this.stopped) return;
    await this.runTrainSpam();

    if (this.stopped) return;
    await this.runTrainHam();

    if (this.stopped) return;
    await this.runTrainWhitelist();

    if (this.stopped) return;
    await this.runTrainBlacklist();

    if (this.stopped) return;
    await this.runScan();
  }

  /**
   * Resolves after `ms`, or immediately once `idleAbortController` aborts
   * (whichever comes first) - used to back off between IDLE-reconnect
   * attempts (task 3.4) without making `stop()` wait out a full backoff
   * delay before the IDLE loop notices shutdown.
   */
  private sleep(ms: number): Promise<void> {
    if (ms <= 0 || this.idleAbortController.signal.aborted) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      this.idleAbortController.signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
  }

  /**
   * The IDLE-first trigger loop for `mode === 'idle'` (design.md D6, task
   * 3.3/3.4). Opens a second, dedicated long-lived connection
   * (`disableAutoIdle: true`, per the Context section - the inbox watcher
   * decides for itself when to enter IDLE, so `imapflow` must never do so on
   * its own initiative) and, while not stopped: waits for a new-mail
   * notification via `waitForNewMail`, triggers `scan`, and immediately
   * re-arms. A dropped/errored connection (either `newClient(...).connect()`
   * itself or `waitForNewMail` throwing) is retried after `backoffMs(...)`
   * of this loop's own failure count, without ever changing `this.mode` back
   * to `'loop'` (design.md D6's explicit requirement).
   */
  private async runIdleLoop(inboxFolder: string): Promise<void> {
    while (!this.stopped) {
      let imap: ImapFlow | undefined;
      try {
        imap = newClient(this.mailbox, this.logger, {
          disableAutoIdle: true,
        });
        await imap.connect();
        this.idleFailureCount = 0;

        while (!this.stopped) {
          await waitForNewMail(imap, inboxFolder, {
            signal: this.idleAbortController.signal,
            logger: this.logger,
          });
          if (this.stopped) break;
          await this.runScan();
        }
      } catch (error) {
        this.idleFailureCount++;
        this.logger.error(
          {
            mailboxId: this.mailbox.id,
            error: error instanceof Error ? error.message : String(error),
          },
          'IDLE connection failed - retrying with backoff',
        );
      } finally {
        if (imap) {
          await safeLogout(imap, this.logger);
        }
      }

      if (this.stopped) break;
      await this.sleep(backoffMs(this.idleFailureCount));
    }
  }

  /**
   * Bootstraps this mailbox (settings load + folder init + IDLE capability
   * check), retrying with backoff on failure rather than giving up after one
   * attempt - `4-mailbox-settings-email` design.md D4's closure of the gap
   * left by `3-mailbox-runners`: a mailbox that can't yet connect/load
   * settings must stay degraded and keep retrying, not stop trying forever.
   * On the first successful `bootstrap()`, starts the global interval (task
   * 3.2/D7) plus - only when `mode === 'idle'` - the dedicated IDLE loop
   * (task 3.3/D6), then returns. `stop()` called mid-retry is checked both
   * right after `bootstrap()` resolves and via `sleep()`'s own abort
   * handling, so shutdown during a bootstrap retry does not wait out a full
   * backoff delay nor attempt one more bootstrap. Resolves without throwing
   * on bootstrap failure so `RunnerRegistry` (task group 4) can start every
   * mailbox's runner independently via `Promise.all`.
   */
  async start(): Promise<void> {
    while (!this.stopped) {
      const result = await this.bootstrap();
      if (result) {
        this.startInterval();
        if (this.mode === 'idle') {
          void this.runIdleLoop(result.folders.inbox);
        }
        return;
      }
      if (this.stopped) return;
      await this.sleep(backoffMs(this.bootstrapFailures));
    }
  }

  /**
   * Requests shutdown: no in-flight job is aborted (its own `finally`-block
   * `safeLogout` still runs when it naturally completes or throws, per
   * design.md D9), but `runJob`'s `do/while` will not re-run a coalesced job
   * once this flag is set, and no new job will be started by the interval
   * (cleared here) or the IDLE loop (task group 3), which is signalled to
   * stop via `idleAbortController` so it does not hang inside a
   * `waitForNewMail` call or a reconnect backoff sleep that would otherwise
   * only resolve on its own.
   */
  stop(): void {
    this.stopped = true;
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = undefined;
    }
    this.idleAbortController.abort();
  }
}
