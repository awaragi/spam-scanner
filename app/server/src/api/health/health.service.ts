import { Injectable } from '@nestjs/common';
import { RunnerRegistry } from '../../runtime/runner-registry.js';
import { AiFailureTracker } from '../../domain/ai/ai-failure-tracker.js';
import { RspamdGateway } from '../../infrastructure/rspamd/rspamd.gateway.js';
import type { MailboxRunnerStatus } from '../../runtime/mailbox-runner.js';

/** One mailbox's entry in `health()`'s `mailboxes` array - design.md D8. */
export interface MailboxHealthSummary {
  mailboxId: string;
  state: MailboxRunnerStatus['state'];
  mode: MailboxRunnerStatus['mode'];
  /** `null` when this mailbox has never once completed a successful scan. */
  lastSuccessfulScanAgeMs: number | null;
}

/** The full shape `health()` returns - design.md D8. */
export interface HealthReport {
  status: 'up';
  rspamd: 'reachable' | 'unreachable';
  ai: ReturnType<AiFailureTracker['status']>;
  mailboxes: MailboxHealthSummary[];
}

function lastSuccessfulScanAgeMs(mailbox: MailboxRunnerStatus): number | null {
  const scan = mailbox.jobs.scan;
  if (scan.lastResult !== 'success' || !scan.lastRunAt) {
    return null;
  }
  return Date.now() - Date.parse(scan.lastRunAt);
}

/**
 * Backs both the unguarded liveness route and the admin-scoped health route
 * (design.md D8): `liveness()` exposes nothing beyond "the process is up",
 * while `health()` assembles the full report from `RunnerRegistry.
 * getStatus()` and a best-effort `RspamdGateway.ping()` probe that never
 * fails the request, only downgrades the reported `rspamd` status.
 */
@Injectable()
export class HealthService {
  constructor(
    private readonly runnerRegistry: RunnerRegistry,
    private readonly aiFailureTracker: AiFailureTracker,
    private readonly rspamdGateway: RspamdGateway,
  ) {}

  /** `GET /health/live` (unguarded) - status only, nothing privileged. */
  liveness(): { status: 'up' } {
    return { status: 'up' };
  }

  /** `GET /admin/health` (`AdminGuard`) - the full report. */
  async health(): Promise<HealthReport> {
    const reachable = await this.rspamdGateway.ping();
    const { mailboxes, ai } = this.runnerRegistry.getStatus();

    return {
      status: 'up',
      rspamd: reachable ? 'reachable' : 'unreachable',
      ai,
      mailboxes: mailboxes.map((mailbox) => ({
        mailboxId: mailbox.mailboxId,
        state: mailbox.state,
        mode: mailbox.mode,
        lastSuccessfulScanAgeMs: lastSuccessfulScanAgeMs(mailbox),
      })),
    };
  }
}
