import {
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { MailboxRepository } from '../infrastructure/mailboxes/mailbox.repository.js';
import { ScanConfig } from '../config/app-config.js';
import { FolderInitService } from '../application/folders/folder-init.service.js';
import { RspamdTrainingService } from '../application/training/rspamd-training.service.js';
import { SenderListTrainingService } from '../application/training/sender-list-training.service.js';
import { ScanService } from '../application/scanning/scan.service.js';
import { AiFailureTracker } from '../domain/ai/ai-failure-tracker.js';
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
  /** One `MailboxRunner` per mailbox id, built at bootstrap and never replaced. */
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
   * Constructs one `MailboxRunner` per mailbox and starts each independently.
   * `MailboxRunner.start()` already resolves rather than rejects on its own
   * bootstrap failure (design.md D1's port from `mailbox-loop.service.ts`),
   * so one mailbox's connect/folder-init failure never blocks another's -
   * `Promise.all` is still wrapped in a try/catch here purely as a defensive
   * backstop in case `start()` ever throws, matching design.md's "a failure
   * in one mailbox's runner SHALL NOT affect any other mailbox's runner, and
   * SHALL NOT stop the server process".
   */
  async onApplicationBootstrap(): Promise<void> {
    const mailboxes = this.mailboxRepository.findAll();
    for (const mailbox of mailboxes) {
      const runner = new MailboxRunner(
        mailbox,
        this.folderInitService,
        this.rspamdTrainingService,
        this.senderListTrainingService,
        this.scanService,
        this.scanConfig,
        this.pinoLogger.logger,
      );
      this.runners.set(mailbox.id, runner);
    }

    try {
      await Promise.all(
        [...this.runners.values()].map((runner) => runner.start()),
      );
    } catch (error) {
      this.pinoLogger.error(
        { error: error instanceof Error ? error.message : String(error) },
        'Unexpected error starting mailbox runners',
      );
    }
  }

  /**
   * Every mailbox's status plus the shared AI failure status - design.md
   * D10.
   */
  getStatus(): RunnerRegistryStatus {
    return {
      mailboxes: [...this.runners.values()].map((runner) =>
        runner.getStatus(),
      ),
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
    const runner = this.runners.get(mailboxId);
    if (!runner) {
      throw new Error(`Unknown mailbox: ${mailboxId}`);
    }
    await runner.triggerNow(job);
  }

  /**
   * Stops every constructed runner - design.md D9. No in-flight job is
   * forcibly aborted; each `MailboxRunner.stop()` only prevents new/coalesced
   * job runs and closes its own timers/IDLE loop, per that method's own
   * contract.
   */
  onApplicationShutdown(): void {
    for (const runner of this.runners.values()) {
      runner.stop();
    }
  }
}
