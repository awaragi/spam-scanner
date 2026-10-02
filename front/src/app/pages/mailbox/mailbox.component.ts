import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService, parseEtagVersion } from '../../core/api.service';
import { clearMailboxSession, getMailboxId, getMailboxToken } from '../../core/auth-storage';
import { SenderListPanelComponent } from './sender-list-panel.component';

const JOBS = [
  'scan',
  'train-spam',
  'train-ham',
  'train-whitelist',
  'train-blacklist',
  'init-folders',
] as const;

@Component({
  selector: 'app-mailbox',
  imports: [SenderListPanelComponent],
  template: `
    <h1>Mailbox: {{ mailboxId }}</h1>
    <p>
      <button type="button" (click)="backToAdmin()">Back to admin</button>
      <button type="button" (click)="refreshStatus()">GET status</button>
      <button type="button" (click)="toggleEnabled()">
        {{ runnerEnabled() ? 'Disable' : 'Enable' }} mailbox
      </button>
      <button type="button" (click)="loadSettings()">GET settings</button>
      <button type="button" (click)="loadState()">GET state</button>
      <button type="button" (click)="deleteState()">DELETE state</button>
    </p>

    <h2>Sender lists</h2>
    <app-sender-list-panel [mailboxId]="mailboxId" kind="whitelist" />
    <app-sender-list-panel [mailboxId]="mailboxId" kind="blacklist" />

    <h2>Trigger jobs</h2>
    @for (job of jobs; track job) {
      <button type="button" (click)="triggerJob(job)">POST jobs/{{ job }}/trigger</button>
    }

    <h2>Output</h2>
    <pre>{{ output() }}</pre>
  `,
})
export class MailboxComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  mailboxId = '';
  readonly jobs = JOBS;
  readonly output = signal('');
  readonly runnerEnabled = signal(true);

  ngOnInit(): void {
    this.mailboxId = this.route.snapshot.paramMap.get('id') ?? getMailboxId() ?? '';
    this.refreshStatus();
  }

  private token(): string {
    return getMailboxToken() ?? '';
  }

  backToAdmin(): void {
    clearMailboxSession();
    void this.router.navigate(['/admin']);
  }

  refreshStatus(): void {
    this.api.mailboxGet<{ enabled: boolean }>(this.token(), this.mailboxId, '/status').subscribe({
      next: (data) => {
        this.runnerEnabled.set(data.enabled);
        this.output.set(JSON.stringify(data, null, 2));
      },
      error: (err) => this.output.set(JSON.stringify(err.error ?? err.message, null, 2)),
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
            this.output.set('Missing ETag on GET /enabled - cannot proceed safely.');
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
              next: () => this.refreshStatus(),
              error: (err) => {
                this.output.set(JSON.stringify(err.error ?? err.message, null, 2));
                if (err.status === 409) this.refreshStatus();
              },
            });
        },
        error: (err) => this.output.set(JSON.stringify(err.error ?? err.message, null, 2)),
      });
  }

  loadSettings(): void {
    this.mailboxGet('/settings');
  }

  loadState(): void {
    this.mailboxGet('/state');
  }

  deleteState(): void {
    this.mailboxDelete('/state');
  }

  triggerJob(job: string): void {
    this.mailboxPost(`/jobs/${job}/trigger`);
  }

  private mailboxGet(path: string): void {
    this.api.mailboxGet<unknown>(this.token(), this.mailboxId, path).subscribe({
      next: (data) => this.output.set(JSON.stringify(data, null, 2)),
      error: (err) => this.output.set(JSON.stringify(err.error ?? err.message, null, 2)),
    });
  }

  private mailboxPost(path: string, body: unknown = {}): void {
    this.api.mailboxPost<unknown>(this.token(), this.mailboxId, path, body).subscribe({
      next: (data) => this.output.set(JSON.stringify(data, null, 2)),
      error: (err) => this.output.set(JSON.stringify(err.error ?? err.message, null, 2)),
    });
  }

  private mailboxDelete(path: string): void {
    this.api.mailboxDelete<unknown>(this.token(), this.mailboxId, path).subscribe({
      next: (data) => this.output.set(JSON.stringify(data, null, 2)),
      error: (err) => this.output.set(JSON.stringify(err.error ?? err.message, null, 2)),
    });
  }
}
