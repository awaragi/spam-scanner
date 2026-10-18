import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTableModule } from '@angular/material/table';
import { ApiService } from '../../core/api.service';
import { clearMailboxSession, getAdminToken, setMailboxSession } from '../../core/auth-storage';
import { ConfirmDialogService } from '../../shared/confirm-dialog.service';
import { httpErrorMessage } from '../../shared/http-error.util';
import { NotifyService } from '../../shared/notify.service';
import { StatusBadgeComponent } from '../../shared/status-badge.component';

interface PublicAccount {
  id: string;
  imapHost: string;
  imapPort: number;
  imapUser: string;
  imapTls: boolean;
  imapAllowInsecure: boolean;
  stateFolder: string;
  enabled: boolean;
  aiEnabled: boolean;
}

interface AccountListing {
  version: number;
  accounts: PublicAccount[];
}

interface RunnerStatus {
  mailboxId: string;
  enabled: boolean;
  state?: 'running' | 'degraded';
  mode?: string;
  lastError?: string;
}

/**
 * One row per mailbox, merging its persisted account record with its live
 * runner status (keyed by id - both the account API and the runner API
 * describe the same mailbox, just one persisted config and one live
 * state). Previously shown as two separate tables with duplicate id
 * columns and two "Enabled" toggles that called the identical endpoint -
 * confusing, since an admin thinks of "pierre@awaragi.com" as one thing.
 */
interface MailboxRow extends PublicAccount {
  state?: 'running' | 'degraded';
  mode?: string;
  lastError?: string;
}

@Component({
  selector: 'app-admin',
  imports: [
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatSlideToggleModule,
    MatTableModule,
    StatusBadgeComponent,
  ],
  template: `
    <h1>Admin</h1>

    <h2>
      Mailboxes (version={{ accountsVersion() }})
      <button type="button" mat-icon-button aria-label="Refresh" (click)="refresh()">
        <mat-icon>refresh</mat-icon>
      </button>
    </h2>
    <a mat-stroked-button [routerLink]="['/admin/accounts/new']" class="add-account-link">
      <mat-icon>add</mat-icon>
      Add mailbox
    </a>
    @if (rows().length === 0) {
      <p>No mailboxes yet.</p>
    } @else {
      <div class="table-scroll">
        <table mat-table [dataSource]="rows()" class="mailboxes-table">
          <ng-container matColumnDef="id">
            <th mat-header-cell *matHeaderCellDef>Mailbox</th>
            <td mat-cell *matCellDef="let row">{{ row.id }}</td>
          </ng-container>
          <ng-container matColumnDef="host">
            <th mat-header-cell *matHeaderCellDef>IMAP host</th>
            <td mat-cell *matCellDef="let row">{{ row.imapHost }}:{{ row.imapPort }}</td>
          </ng-container>
          <ng-container matColumnDef="status">
            <th mat-header-cell *matHeaderCellDef>Status</th>
            <td mat-cell *matCellDef="let row">
              <app-status-badge [status]="{ enabled: row.enabled, state: row.state }" />
              @if (row.lastError) {
                <div class="last-error">{{ row.lastError }}</div>
              }
            </td>
          </ng-container>
          <ng-container matColumnDef="enabled">
            <th mat-header-cell *matHeaderCellDef>Enabled</th>
            <td mat-cell *matCellDef="let row">
              <mat-slide-toggle [checked]="row.enabled" (change)="toggleEnabled(row)" />
            </td>
          </ng-container>
          <ng-container matColumnDef="aiEnabled">
            <th mat-header-cell *matHeaderCellDef>AI</th>
            <td mat-cell *matCellDef="let row">
              <mat-slide-toggle [checked]="row.aiEnabled" (change)="toggleAiEnabled(row)" />
            </td>
          </ng-container>
          <ng-container matColumnDef="actions">
            <th mat-header-cell *matHeaderCellDef></th>
            <td mat-cell *matCellDef="let row">
              <button type="button" mat-button (click)="openMailbox(row.id)">Open</button>
              <button type="button" mat-button color="warn" (click)="deleteAccount(row)">
                Delete
              </button>
            </td>
          </ng-container>
          <tr mat-header-row *matHeaderRowDef="columns"></tr>
          <tr mat-row *matRowDef="let row; columns: columns"></tr>
        </table>
      </div>
    }
  `,
  styles: [
    `
      table {
        width: 100%;
      }
      .table-scroll {
        overflow-x: auto;
        margin-bottom: 1.5rem;
      }
      .last-error {
        font-size: 0.75rem;
        color: var(--mat-sys-error);
      }
      .add-account-link {
        margin-bottom: 0.75rem;
      }
    `,
  ],
})
export class AdminComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly notify = inject(NotifyService);

  readonly columns = ['id', 'host', 'status', 'enabled', 'aiEnabled', 'actions'];

  readonly mailboxes = signal<RunnerStatus[]>([]);
  readonly accounts = signal<PublicAccount[]>([]);
  readonly accountsVersion = signal<number | null>(null);

  readonly rows = computed<MailboxRow[]>(() => {
    const statusById = new Map(this.mailboxes().map((mb) => [mb.mailboxId, mb]));
    return this.accounts().map((account) => {
      const status = statusById.get(account.id);
      return {
        ...account,
        state: status?.state,
        mode: status?.mode,
        lastError: status?.lastError,
      };
    });
  });

  ngOnInit(): void {
    clearMailboxSession();
    this.refresh();
  }

  private adminToken(): string {
    return getAdminToken() ?? '';
  }

  refresh(): void {
    this.loadMailboxes();
    this.loadAccounts();
  }

  private loadMailboxes(): void {
    this.api.adminGet<RunnerStatus[]>(this.adminToken(), '/admin/mailboxes').subscribe({
      next: (data) => this.mailboxes.set(data),
      error: (err) => this.notify.error(httpErrorMessage(err, 'Could not load mailboxes.')),
    });
  }

  private loadAccounts(): void {
    this.api.adminGetWithEtag<AccountListing>(this.adminToken(), '/admin/accounts').subscribe({
      next: ({ body }) => {
        this.accounts.set(body.accounts);
        this.accountsVersion.set(body.version);
      },
      error: (err) => this.notify.error(httpErrorMessage(err, 'Could not load accounts.')),
    });
  }

  /**
   * Persistent enable/disable, through `AccountAdminService` on the server -
   * the toggle survives a restart, so there's no "(until restart)" caveat
   * any more. Re-fetches the account version right before writing so a
   * stale `accountsVersion()` (e.g. another admin tab's edit) surfaces as a
   * normal 409-driven refresh rather than silently clobbering it.
   */
  toggleEnabled(row: MailboxRow): void {
    this.api.adminGetWithEtag<AccountListing>(this.adminToken(), '/admin/accounts').subscribe({
      next: ({ body }) => {
        const version = body.version;
        this.api
          .adminWriteWithEtag<{ updated: true }>(
            this.adminToken(),
            'PUT',
            `/admin/mailboxes/${encodeURIComponent(row.id)}/enabled`,
            version,
            { enabled: !row.enabled },
          )
          .subscribe({
            next: () => {
              this.refresh();
              this.notify.success(`${row.id} ${row.enabled ? 'disabled' : 'enabled'}.`);
            },
            error: (err) => this.handle409OrError(err),
          });
      },
      error: (err) => this.notify.error(httpErrorMessage(err)),
    });
  }

  /**
   * Re-fetches the account version right before writing - same pattern as
   * `toggleEnabled` - so a stale `accountsVersion()` (e.g. another admin
   * tab's edit) surfaces as a normal 409-driven refresh rather than forcing
   * a manual retry.
   */
  toggleAiEnabled(row: MailboxRow): void {
    this.api.adminGetWithEtag<AccountListing>(this.adminToken(), '/admin/accounts').subscribe({
      next: ({ body: current }) => {
        this.api
          .adminWriteWithEtag<AccountListing>(
            this.adminToken(),
            'PATCH',
            `/admin/accounts/${encodeURIComponent(row.id)}`,
            current.version,
            { aiEnabled: !row.aiEnabled },
          )
          .subscribe({
            next: ({ body }) => {
              this.accounts.set(body.accounts);
              this.accountsVersion.set(body.version);
              this.notify.success(`AI ${row.aiEnabled ? 'disabled' : 'enabled'} for ${row.id}.`);
            },
            error: (err) => this.handle409OrError(err),
          });
      },
      error: (err) => this.notify.error(httpErrorMessage(err)),
    });
  }

  /** Same re-fetch-before-write pattern as `toggleAiEnabled` - see its doc comment.
   * Gated by a confirmation dialog (specs/front-end/control-ui: destructive
   * actions require confirmation). */
  deleteAccount(row: MailboxRow): void {
    this.confirmDialog
      .confirm({
        title: 'Delete account',
        message: `Delete ${row.id}? This stops its runner and removes it from the account list.`,
      })
      .subscribe((confirmed) => {
        if (!confirmed) return;
        this.api.adminGetWithEtag<AccountListing>(this.adminToken(), '/admin/accounts').subscribe({
          next: ({ body: current }) => {
            this.api
              .adminWriteWithEtag<AccountListing>(
                this.adminToken(),
                'DELETE',
                `/admin/accounts/${encodeURIComponent(row.id)}`,
                current.version,
              )
              .subscribe({
                next: ({ body }) => {
                  this.accounts.set(body.accounts);
                  this.accountsVersion.set(body.version);
                  this.loadMailboxes();
                  this.notify.success(`${row.id} deleted.`);
                  // Same "offer to re-add with edits" convenience the old
                  // inline form gave for free - now a route hop, carrying
                  // the removed account (no password) as navigation state
                  // for `CreateAccountComponent` to prefill from.
                  void this.router.navigate(['/admin/accounts/new'], {
                    state: { prefillAccount: row },
                  });
                },
                error: (err) => this.handle409OrError(err),
              });
          },
          error: (err) => this.notify.error(httpErrorMessage(err)),
        });
      });
  }

  /** Admin token → scoped mailbox JWT, then mailbox UI. */
  openMailbox(mailboxId: string): void {
    this.api.exchangeMailboxToken(this.adminToken(), mailboxId).subscribe({
      next: ({ token }) => {
        setMailboxSession(mailboxId, token);
        void this.router.navigate(['/mailbox', mailboxId]);
      },
      error: (err) => this.notify.error(httpErrorMessage(err, 'Could not open mailbox.')),
    });
  }

  /** A 409 means `accountsVersion()` is stale (another edit landed first) -
   * refresh the accounts list so the next mutation targets the current
   * version, rather than looping on the same stale `If-Match` forever. */
  private handle409OrError(err: { status?: number; error?: unknown; message?: string }): void {
    this.notify.error(httpErrorMessage(err));
    if (err.status === 409) {
      this.loadAccounts();
    }
  }
}
