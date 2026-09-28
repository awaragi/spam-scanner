import { Component, inject, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../core/api.service';
import {
  clearAdminToken,
  clearMailboxSession,
  getAdminToken,
  setMailboxSession,
} from '../../core/auth-storage';

@Component({
  selector: 'app-admin',
  imports: [],
  template: `
    <h1>Admin</h1>
    <p>
      <button type="button" (click)="logout()">Logout admin</button>
      <button type="button" (click)="loadMailboxes()">Refresh mailboxes</button>
      <button type="button" (click)="loadHealth()">GET /admin/health</button>
      <button type="button" (click)="loadSettings()">GET /admin/settings</button>
      <button type="button" (click)="checkLive()">GET /health/live</button>
    </p>

    <h2>Mailboxes</h2>
    @if (mailboxes().length === 0) {
      <p>No mailboxes (or not loaded yet).</p>
    }
    <ul>
      @for (mb of mailboxes(); track mb.mailboxId) {
        <li>
          {{ mb.mailboxId }} — state={{ mb.state }} mode={{ mb.mode }}
          @if (mb.lastError) {
            <span> err={{ mb.lastError }}</span>
          }
          <button type="button" (click)="openMailbox(mb.mailboxId)">Open mailbox</button>
        </li>
      }
    </ul>

    <h2>Output</h2>
    <pre>{{ output() }}</pre>
  `,
})
export class AdminComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  readonly mailboxes = signal<
    Array<{ mailboxId: string; state: string; mode: string; lastError?: string }>
  >([]);
  readonly output = signal('');

  ngOnInit(): void {
    clearMailboxSession();
    this.loadMailboxes();
  }

  private adminToken(): string {
    return getAdminToken() ?? '';
  }

  loadMailboxes(): void {
    this.api.adminGet<unknown[]>(this.adminToken(), '/admin/mailboxes').subscribe({
      next: (data) => {
        this.mailboxes.set(
          data as Array<{
            mailboxId: string;
            state: string;
            mode: string;
            lastError?: string;
          }>,
        );
        this.output.set(JSON.stringify(data, null, 2));
      },
      error: (err) => this.output.set(JSON.stringify(err.error ?? err.message, null, 2)),
    });
  }

  loadHealth(): void {
    this.api.adminGet<unknown>(this.adminToken(), '/admin/health').subscribe({
      next: (data) => this.output.set(JSON.stringify(data, null, 2)),
      error: (err) => this.output.set(JSON.stringify(err.error ?? err.message, null, 2)),
    });
  }

  loadSettings(): void {
    this.api.adminGet<unknown>(this.adminToken(), '/admin/settings').subscribe({
      next: (data) => this.output.set(JSON.stringify(data, null, 2)),
      error: (err) => this.output.set(JSON.stringify(err.error ?? err.message, null, 2)),
    });
  }

  checkLive(): void {
    this.api.liveness().subscribe({
      next: (data) => this.output.set(JSON.stringify(data, null, 2)),
      error: (err) => this.output.set(JSON.stringify(err.error ?? err.message, null, 2)),
    });
  }

  openMailbox(mailboxId: string): void {
    this.api.exchangeMailboxToken(this.adminToken(), mailboxId).subscribe({
      next: ({ token }) => {
        setMailboxSession(mailboxId, token);
        void this.router.navigate(['/mailbox', mailboxId]);
      },
      error: (err) => this.output.set(JSON.stringify(err.error ?? err.message, null, 2)),
    });
  }

  logout(): void {
    clearAdminToken();
    clearMailboxSession();
    void this.router.navigate(['/login']);
  }
}
