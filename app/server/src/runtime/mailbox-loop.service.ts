import {
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { ImapFlow } from 'imapflow';
import { MailboxRepository } from '../infrastructure/mailboxes/mailbox.repository.js';
import type { Mailbox } from '../infrastructure/mailboxes/mailbox.js';
import { ScanConfig } from '../config/app-config.js';
import { defaultMailboxSettings } from '../config/mailbox-settings.defaults.js';
import {
  newClient,
  safeLogout,
} from '../infrastructure/imap/imap-connection.factory.js';
import { resolveMailboxFolders } from '../infrastructure/imap/folder.resolver.js';
import {
  createMailboxSession,
  type MailboxSession,
} from '../application/mailbox-session.js';
import { FolderInitService } from '../application/folders/folder-init.service.js';
import { RspamdTrainingService } from '../application/training/rspamd-training.service.js';
import { SenderListTrainingService } from '../application/training/sender-list-training.service.js';
import { ScanService } from '../application/scanning/scan.service.js';

/**
 * The minimal run loop from design.md D9: for each mailbox the
 * `MailboxRepository` returns, runs folder init once at startup and then, on
 * every `SCAN_INTERVAL` tick, trains rspamd and the sender lists before
 * scanning the inbox until a pass processes zero messages.
 *
 * This is deliberately temporary. There is no IDLE, no single-flight/
 * coalescing, and no degraded/backoff state - see the Non-Goals in
 * design.md, all reserved for `3-mailbox-runners`. Every job (folder init,
 * each training run, each scan pass) opens its own fresh `MailboxSession` -
 * one IMAP connection per job, closed before the next one opens - rather
 * than holding a single connection open for the process lifetime.
 *
 * A failure in any one job is logged and swallowed rather than propagated:
 * that job's own IMAP connection is still closed, and the tick moves on to
 * its next job (a failed scan pass simply ends that tick's drain loop, the
 * same as a pass that processed zero messages) rather than aborting the
 * whole tick. The timer keeps running for the next tick regardless. Nothing
 * here ever exits the process over a single mailbox's failure.
 */
@Injectable()
export class MailboxLoopService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  /** One repeating timer per mailbox id, cleared on shutdown. */
  private readonly timers = new Map<string, NodeJS.Timeout>();
  /**
   * Set once shutdown has been requested, so a mailbox whose bootstrap
   * (connect + folder init) is still in flight when shutdown fires does not
   * go on to schedule a timer afterwards.
   */
  private stopped = false;

  constructor(
    private readonly mailboxRepository: MailboxRepository,
    private readonly scanConfig: ScanConfig,
    private readonly folderInitService: FolderInitService,
    private readonly rspamdTrainingService: RspamdTrainingService,
    private readonly senderListTrainingService: SenderListTrainingService,
    private readonly scanService: ScanService,
    private readonly pinoLogger: PinoLogger,
  ) {}

  /**
   * For every mailbox in the registry: run folder init once, then start its
   * repeating tick timer. Each mailbox bootstraps independently - one
   * mailbox failing folder init is logged and that mailbox's loop simply
   * never starts, but it does not stop any other mailbox's bootstrap.
   */
  async onApplicationBootstrap(): Promise<void> {
    const mailboxes = this.mailboxRepository.findAll();
    await Promise.all(
      mailboxes.map((mailbox) => this.bootstrapMailbox(mailbox)),
    );
  }

  /**
   * Stops every mailbox's timer so no new tick starts. Per design.md D9,
   * this minimal version does not wait for, or attempt to cancel, a tick
   * that is already in flight - that is `3-mailbox-runners`'s job.
   */
  onApplicationShutdown(): void {
    this.stopped = true;
    for (const timer of this.timers.values()) {
      clearInterval(timer);
    }
    this.timers.clear();
  }

  /**
   * Opens one fresh `MailboxSession` for a single job: connects a new IMAP
   * client, resolves this mailbox's folders against the server's real
   * delimiter, and assembles the session around `defaultMailboxSettings`
   * (there is no per-mailbox settings override storage yet - see design.md
   * D5). The caller is responsible for closing `session.imap` (via
   * `safeLogout`) once its job is done.
   */
  private async openSession(mailbox: Mailbox): Promise<MailboxSession> {
    const baseLogger = this.pinoLogger.logger;
    const imap: ImapFlow = newClient(mailbox, baseLogger);
    await imap.connect();
    const folders = await resolveMailboxFolders(imap, {
      ...defaultMailboxSettings.folders,
      state: mailbox.stateFolder,
    });
    return createMailboxSession({
      mailbox,
      imap,
      settings: defaultMailboxSettings,
      folders,
      logger: baseLogger,
    });
  }

  /**
   * Runs folder init once for a mailbox, in its own session, and - only on
   * success - starts its repeating tick timer. Bootstrap failures (a
   * connect failure or `initFolders` itself failing) are logged and leave
   * this mailbox without a running loop, rather than crashing the process
   * or blocking any other mailbox's bootstrap.
   */
  private async bootstrapMailbox(mailbox: Mailbox): Promise<void> {
    try {
      const session = await this.openSession(mailbox);
      try {
        await this.folderInitService.initFolders(session);
      } finally {
        await safeLogout(session.imap, session.logger);
      }
    } catch (error) {
      this.pinoLogger.error(
        {
          mailboxId: mailbox.id,
          error: error instanceof Error ? error.message : String(error),
        },
        'Mailbox bootstrap (connect + folder init) failed - its scan loop will not start',
      );
      return;
    }

    // Shutdown may have been requested while bootstrap above was still in
    // flight - don't start a timer that onApplicationShutdown has already
    // run and will never see.
    if (this.stopped) {
      return;
    }

    const intervalMs = this.scanConfig.scanIntervalSeconds * 1000;
    const timer = setInterval(() => {
      void this.runTick(mailbox);
    }, intervalMs);
    this.timers.set(mailbox.id, timer);
  }

  /**
   * Runs exactly one job in its own fresh `MailboxSession`: opens the
   * session, runs `jobFn` against it, and always closes the IMAP connection
   * in `finally` - mirroring terminal orchestrator's `runStep()`, which
   * connects, runs one workflow function, and logs out once per step.
   *
   * A failure opening the session or running the job is logged and
   * swallowed rather than propagated, so the caller can unconditionally move
   * on to the next job in the tick's sequence. `undefined` is returned on
   * failure so a caller that needs the job's result (the scan drain loop)
   * can tell a failed pass apart from a successful one.
   */
  private async runJob<T>(
    mailbox: Mailbox,
    jobName: string,
    jobFn: (session: MailboxSession) => Promise<T>,
  ): Promise<T | undefined> {
    let session: MailboxSession | undefined;
    try {
      session = await this.openSession(mailbox);
      return await jobFn(session);
    } catch (error) {
      this.pinoLogger.error(
        {
          mailboxId: mailbox.id,
          job: jobName,
          error: error instanceof Error ? error.message : String(error),
        },
        'Mailbox job failed - continuing with the next job this tick',
      );
      return undefined;
    } finally {
      if (session) {
        await safeLogout(session.imap, session.logger);
      }
    }
  }

  /**
   * One tick for one mailbox: the four training jobs in order, then
   * scan-until-drained (repeating `scanService.runScan` until a pass reports
   * `processed === 0`). Per design.md D9, each job gets its own fresh
   * session via `runJob` - one IMAP connection per job, not one shared
   * connection for the whole tick.
   *
   * A job failing is logged (inside `runJob`) and does not stop the rest of
   * the tick: the next job in the sequence still runs. A failed scan pass is
   * treated the same as a pass that processed zero messages - it ends the
   * drain loop for this tick rather than retrying forever.
   *
   * `this.stopped` is checked before every job, not just once per tick, so a
   * shutdown requested mid-tick stops the remaining jobs in that tick from
   * starting too, rather than only preventing the next tick.
   */
  private async runTick(mailbox: Mailbox): Promise<void> {
    if (this.stopped) return;
    await this.runJob(mailbox, 'runSpam', (session) =>
      this.rspamdTrainingService.runSpam(session),
    );

    if (this.stopped) return;
    await this.runJob(mailbox, 'runHam', (session) =>
      this.rspamdTrainingService.runHam(session),
    );

    if (this.stopped) return;
    await this.runJob(mailbox, 'runWhitelist', (session) =>
      this.senderListTrainingService.runWhitelist(session),
    );

    if (this.stopped) return;
    await this.runJob(mailbox, 'runBlacklist', (session) =>
      this.senderListTrainingService.runBlacklist(session),
    );

    for (;;) {
      if (this.stopped) return;
      const result = await this.runJob(mailbox, 'runScan', (session) =>
        this.scanService.runScan(session),
      );
      if (!result || result.processed === 0) {
        return;
      }
    }
  }
}
