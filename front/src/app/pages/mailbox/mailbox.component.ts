import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { ApiService, parseEtagVersion } from '../../core/api.service';
import { getMailboxId, getMailboxToken } from '../../core/auth-storage';
import { ConfirmDialogService } from '../../shared/confirm-dialog.service';
import { httpErrorMessage } from '../../shared/http-error.util';
import { NotifyService } from '../../shared/notify.service';
import { StatusBadgeComponent } from '../../shared/status-badge.component';
import { JobsStatus, KebabJobName, isJobTriggerDisabled } from './job-trigger.util';
import { SenderListPanelComponent } from './sender-list-panel.component';

const JOBS: { kebab: KebabJobName; label: string }[] = [
  { kebab: 'scan', label: 'Scan' },
  { kebab: 'train-spam', label: 'Train spam' },
  { kebab: 'train-ham', label: 'Train ham' },
  { kebab: 'train-whitelist', label: 'Train whitelist' },
  { kebab: 'train-blacklist', label: 'Train blacklist' },
  { kebab: 'init-folders', label: 'Initialize folders' },
];

interface ScannerState {
  last_uid: number;
  last_seen_date: string;
  last_checked: string;
  uid_validity?: string;
}

@Component({
  selector: 'app-mailbox',
  imports: [
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSlideToggleModule,
    StatusBadgeComponent,
    SenderListPanelComponent,
  ],
  template: `
    <section class="status-row">
      <app-status-badge [status]="{ enabled: runnerEnabled(), state: runnerState() }" />
      <mat-slide-toggle [checked]="runnerEnabled()" (change)="toggleEnabled()">
        Enabled
      </mat-slide-toggle>
      <span class="spacer"></span>
      <a mat-stroked-button [routerLink]="['settings']">
        <mat-icon>settings</mat-icon>
        Settings
      </a>
    </section>

    <h2>Jobs</h2>
    <div class="job-row">
      @for (job of jobs; track job.kebab) {
        <button
          type="button"
          mat-stroked-button
          [disabled]="isJobDisabled(job.kebab)"
          (click)="triggerJob(job.kebab)"
        >
          @if (isPending(job.kebab)) {
            <mat-progress-spinner diameter="16" mode="indeterminate" />
          }
          {{ job.label }}
        </button>
      }
    </div>

    <h2>Scanner state</h2>
    @if (state() === undefined) {
      <p>Loading…</p>
    } @else if (state() === null) {
      <p>No scanner state yet.</p>
    } @else {
      <dl class="state-summary">
        <dt>Last UID</dt>
        <dd>{{ state()!.last_uid }}</dd>
        <dt>Last seen date</dt>
        <dd>{{ state()!.last_seen_date }}</dd>
        <dt>Last checked</dt>
        <dd>{{ state()!.last_checked }}</dd>
        @if (state()!.uid_validity) {
          <dt>UID validity</dt>
          <dd>{{ state()!.uid_validity }}</dd>
        }
      </dl>
    }
    <button type="button" mat-stroked-button color="warn" (click)="resetState()">
      Reset state
    </button>

    <h2>Sender lists</h2>
    <app-sender-list-panel [mailboxId]="mailboxId" kind="whitelist" />
    <app-sender-list-panel [mailboxId]="mailboxId" kind="blacklist" />
  `,
  styles: [
    `
      .status-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 1rem;
        margin-bottom: 1rem;
      }
      .spacer {
        flex: 1 1 auto;
      }
      .job-row {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem;
        margin-bottom: 1.5rem;
      }
      .job-row button mat-progress-spinner {
        display: inline-block;
        margin-right: 0.5rem;
        vertical-align: middle;
      }
      .state-summary {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 0.25rem 1rem;
        max-width: 24rem;
      }
      .state-summary dt {
        font-weight: 500;
      }
      .state-summary dd {
        margin: 0;
      }
    `,
  ],
})
export class MailboxComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly notify = inject(NotifyService);

  mailboxId = '';
  readonly jobs = JOBS;

  readonly runnerEnabled = signal(true);
  readonly runnerState = signal<'running' | 'degraded' | undefined>(undefined);
  readonly jobsStatus = signal<JobsStatus | undefined>(undefined);
  /** Jobs with a trigger request currently in flight. The server awaits a
   * job's full completion before responding (design.md D4), so the request
   * itself is the only "running" window the UI can ever observe for a
   * self-triggered job - this is what the Scan/Train/... buttons actually
   * show a spinner and disable against, separately from `jobsStatus()`. */
  readonly pendingJobs = signal<ReadonlySet<KebabJobName>>(new Set());
  /** `undefined` = not loaded yet, `null` = loaded, no state exists. */
  readonly state = signal<ScannerState | null | undefined>(undefined);

  ngOnInit(): void {
    this.mailboxId = this.route.snapshot.paramMap.get('id') ?? getMailboxId() ?? '';
    this.refreshStatus();
    this.reloadState();
  }

  private token(): string {
    return getMailboxToken() ?? '';
  }

  isJobDisabled(job: KebabJobName): boolean {
    return isJobTriggerDisabled(job, this.jobsStatus()) || this.isPending(job);
  }

  isPending(job: KebabJobName): boolean {
    return this.pendingJobs().has(job);
  }

  refreshStatus(): void {
    this.api
      .mailboxGet<{
        enabled: boolean;
        state?: 'running' | 'degraded';
        jobs?: JobsStatus;
      }>(this.token(), this.mailboxId, '/status')
      .subscribe({
        next: (data) => {
          this.runnerEnabled.set(data.enabled);
          this.runnerState.set(data.state);
          this.jobsStatus.set(data.jobs);
        },
        error: (err) => this.notify.error(httpErrorMessage(err, 'Could not load status.')),
      });
  }

  /**
   * Persistent enable/disable through `AccountAdminService` on the server -
   * survives a restart, so there's no "(until restart)" caveat any more.
   * The mailbox owner has no access to `/admin/accounts` for a version to
   * send as `If-Match`, so this fetches one from the mailbox-scoped
   * `GET .../enabled` (its `ETag` response header) right before writing.
   */
  toggleEnabled(): void {
    const next = !this.runnerEnabled();
    this.api
      .mailboxGetWithEtag<{ enabled: boolean }>(this.token(), this.mailboxId, '/enabled')
      .subscribe({
        next: ({ etag }) => {
          const version = parseEtagVersion(etag);
          if (version === null) {
            this.notify.error('Missing ETag on GET /enabled - cannot proceed safely.');
            return;
          }
          this.api
            .mailboxWriteWithEtag<{ updated: true }>(
              this.token(),
              this.mailboxId,
              'PUT',
              '/enabled',
              version,
              { enabled: next },
            )
            .subscribe({
              next: () => {
                this.refreshStatus();
                this.notify.success(`Mailbox ${next ? 'enabled' : 'disabled'}.`);
              },
              error: (err) => {
                this.notify.error(httpErrorMessage(err));
                if (err.status === 409) this.refreshStatus();
              },
            });
        },
        error: (err) => this.notify.error(httpErrorMessage(err)),
      });
  }

  triggerJob(job: KebabJobName): void {
    this.setPending(job, true);
    this.api
      .mailboxPost<{ triggered: true }>(this.token(), this.mailboxId, `/jobs/${job}/trigger`)
      .subscribe({
        next: () => {
          this.setPending(job, false);
          this.notify.success(`${job} finished.`);
          this.refreshStatus();
          // The job already fully ran by the time this response arrives
          // (the server awaits it - see `pendingJobs`'s doc comment), so
          // scanner state may have genuinely changed; the status refresh
          // above doesn't cover that on its own.
          this.reloadState();
        },
        error: (err) => {
          this.setPending(job, false);
          this.notify.error(httpErrorMessage(err, `Could not trigger ${job}.`));
        },
      });
  }

  private setPending(job: KebabJobName, pending: boolean): void {
    const next = new Set(this.pendingJobs());
    if (pending) {
      next.add(job);
    } else {
      next.delete(job);
    }
    this.pendingJobs.set(next);
  }

  reloadState(): void {
    this.api.mailboxGet<ScannerState | null>(this.token(), this.mailboxId, '/state').subscribe({
      next: (data) => this.state.set(data),
      error: (err) => this.notify.error(httpErrorMessage(err, 'Could not load scanner state.')),
    });
  }

  resetState(): void {
    this.confirmDialog
      .confirm({
        title: 'Reset scanner state',
        message:
          "Reset this mailbox's scanner state? The next scan will re-establish it from scratch.",
      })
      .subscribe((confirmed) => {
        if (!confirmed) return;
        this.api
          .mailboxDelete<{ deleted: boolean }>(this.token(), this.mailboxId, '/state')
          .subscribe({
            next: () => {
              this.notify.success('Scanner state reset.');
              this.reloadState();
            },
            error: (err) => this.notify.error(httpErrorMessage(err, 'Could not reset state.')),
          });
      });
  }
}
