import { Component, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ApiService } from '../../core/api.service';
import {
  clearMailboxSession,
  getMailboxId,
  getMailboxToken,
} from '../../core/auth-storage';
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
      <button type="button" (click)="loadSettings()">GET settings</button>
      <button type="button" (click)="loadState()">GET state</button>
      <button type="button" (click)="resetState()">POST state/reset</button>
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

  ngOnInit(): void {
    this.mailboxId =
      this.route.snapshot.paramMap.get('id') ?? getMailboxId() ?? '';
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
    this.mailboxGet('/status');
  }

  loadSettings(): void {
    this.mailboxGet('/settings');
  }

  loadState(): void {
    this.mailboxGet('/state');
  }

  resetState(): void {
    this.mailboxPost('/state/reset');
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
    this.api
      .mailboxPost<unknown>(this.token(), this.mailboxId, path, body)
      .subscribe({
        next: (data) => this.output.set(JSON.stringify(data, null, 2)),
        error: (err) => this.output.set(JSON.stringify(err.error ?? err.message, null, 2)),
      });
  }
}
