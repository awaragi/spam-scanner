import { Component, ElementRef, inject, OnInit, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { ApiService } from '../../core/api.service';
import {
  clearAdminToken,
  clearMailboxSession,
  getAdminToken,
  setMailboxSession,
} from '../../core/auth-storage';

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
  state?: string;
  mode?: string;
  lastError?: string;
}

@Component({
  selector: 'app-admin',
  imports: [],
  styles: [
    `
      .create-form {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        max-width: 40rem;
        margin-bottom: 1rem;
      }
      .create-form .row {
        display: grid;
        grid-template-columns: 11rem 1fr;
        align-items: center;
        gap: 0.75rem;
      }
      .create-form .row > label:first-child {
        font-weight: 500;
      }
      .create-form input[type='text'],
      .create-form input[type='email'],
      .create-form input[type='password'],
      .create-form input[type='number'] {
        width: 100%;
        box-sizing: border-box;
        padding: 0.25rem 0.4rem;
      }
      .create-form .checkbox-inline {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-weight: normal;
      }
      .create-form .actions {
        margin-top: 0.25rem;
      }
    `,
  ],
  template: `
    <h1>Admin</h1>
    <p>
      <button type="button" (click)="logout()">Logout admin</button>
      <button type="button" (click)="loadMailboxes()">Refresh mailboxes</button>
      <button type="button" (click)="loadAccounts()">Refresh accounts</button>
      <button type="button" (click)="loadHealth()">GET /admin/health</button>
      <button type="button" (click)="loadSettings()">GET /admin/settings</button>
      <button type="button" (click)="checkLive()">GET /health/live</button>
    </p>

    <h2>Runner status</h2>
    @if (mailboxes().length === 0) {
      <p>No mailboxes running (or not loaded yet).</p>
    }
    <ul>
      @for (mb of mailboxes(); track mb.mailboxId) {
        <li>
          {{ mb.mailboxId }} — enabled={{ mb.enabled }}
          @if (mb.enabled) {
            <span> state={{ mb.state }} mode={{ mb.mode }}</span>
            @if (mb.lastError) {
              <span> err={{ mb.lastError }}</span>
            }
          }
          <button type="button" (click)="toggleEnabled(mb)">
            {{ mb.enabled ? 'Disable' : 'Enable' }}
          </button>
          <button type="button" (click)="openMailbox(mb.mailboxId)">Open mailbox</button>
        </li>
      }
    </ul>

    <h2>Accounts (version={{ accountsVersion() }})</h2>
    <ul>
      @for (account of accounts(); track account.id) {
        <li>
          {{ account.id }} — {{ account.imapHost }}:{{ account.imapPort }} — enabled={{
            account.enabled
          }}
          — aiEnabled={{ account.aiEnabled }}
          <button type="button" (click)="toggleAccountEnabled(account)">
            {{ account.enabled ? 'Disable account' : 'Enable account' }}
          </button>
          <button type="button" (click)="toggleAiEnabled(account)">
            {{ account.aiEnabled ? 'Disable AI' : 'Enable AI' }}
          </button>
          <button type="button" (click)="openMailbox(account.id)">Open mailbox</button>
          <button type="button" (click)="deleteAccount(account)">Delete</button>
        </li>
      }
    </ul>

    <h3>Create account</h3>
    <form #createForm class="create-form" (submit)="createAccount($event)">
      <div class="row">
        <label for="create-id">Mailbox id</label>
        <input id="create-id" name="id" type="email" autocomplete="off" required />
      </div>
      <div class="row">
        <label for="create-imapHost">IMAP host</label>
        <input id="create-imapHost" name="imapHost" type="text" required />
      </div>
      <div class="row">
        <label for="create-imapPort">IMAP port</label>
        <input id="create-imapPort" name="imapPort" type="number" placeholder="993" />
      </div>
      <div class="row">
        <label for="create-imapUser">IMAP user</label>
        <input id="create-imapUser" name="imapUser" type="text" required />
      </div>
      <div class="row">
        <label for="create-imapPassword">IMAP password</label>
        <input
          id="create-imapPassword"
          name="imapPassword"
          type="password"
          autocomplete="new-password"
          required
        />
      </div>
      <div class="row">
        <label for="create-stateFolder">State folder</label>
        <input
          id="create-stateFolder"
          name="stateFolder"
          type="text"
          placeholder="INBOX.scanner.state"
        />
      </div>
      <div class="row">
        <label for="create-imapTls">IMAP TLS</label>
        <input id="create-imapTls" type="checkbox" name="imapTls" checked />
      </div>
      <div class="row">
        <label for="create-imapAllowInsecure">Allow insecure</label>
        <input id="create-imapAllowInsecure" type="checkbox" name="imapAllowInsecure" />
      </div>
      <div class="row">
        <label for="create-enabled">Enabled</label>
        <label class="checkbox-inline">
          <input id="create-enabled" type="checkbox" name="enabled" checked />
          Start runner after successful IMAP test
        </label>
      </div>
      <div class="row">
        <label for="create-aiEnabled">AI enabled</label>
        <input id="create-aiEnabled" type="checkbox" name="aiEnabled" checked />
      </div>
      <div class="actions">
        <button type="submit">Create account</button>
      </div>
    </form>

    <h2>Output</h2>
    <pre>{{ output() }}</pre>
  `,
})
export class AdminComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  private readonly createFormRef = viewChild<ElementRef<HTMLFormElement>>('createForm');

  readonly mailboxes = signal<RunnerStatus[]>([]);
  readonly accounts = signal<PublicAccount[]>([]);
  readonly accountsVersion = signal<number | null>(null);
  readonly output = signal('');

  ngOnInit(): void {
    clearMailboxSession();
    this.loadMailboxes();
    this.loadAccounts();
  }

  private adminToken(): string {
    return getAdminToken() ?? '';
  }

  loadMailboxes(): void {
    this.api.adminGet<RunnerStatus[]>(this.adminToken(), '/admin/mailboxes').subscribe({
      next: (data) => {
        this.mailboxes.set(data);
        this.output.set(JSON.stringify(data, null, 2));
      },
      error: (err) => this.output.set(JSON.stringify(err.error ?? err.message, null, 2)),
    });
  }

  loadAccounts(): void {
    this.api.adminGetWithEtag<AccountListing>(this.adminToken(), '/admin/accounts').subscribe({
      next: ({ body }) => {
        this.accounts.set(body.accounts);
        this.accountsVersion.set(body.version);
        this.output.set(JSON.stringify(body, null, 2));
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

  /**
   * Persistent enable/disable, through `AccountAdminService` on the server -
   * the toggle survives a restart, so there's no "(until restart)" caveat
   * any more. Re-fetches the account version right before writing so a
   * stale `accountsVersion()` (e.g. another admin tab's edit) surfaces as a
   * normal 409-driven refresh rather than silently clobbering it.
   */
  toggleEnabled(mb: RunnerStatus): void {
    this.api.adminGetWithEtag<AccountListing>(this.adminToken(), '/admin/accounts').subscribe({
      next: ({ body }) => {
        const version = body.version;
        this.api
          .adminWriteWithEtag<{ updated: true }>(
            this.adminToken(),
            'PUT',
            `/admin/mailboxes/${encodeURIComponent(mb.mailboxId)}/enabled`,
            version,
            { enabled: !mb.enabled },
          )
          .subscribe({
            next: () => {
              this.loadMailboxes();
              this.loadAccounts();
            },
            error: (err) => this.handle409OrError(err),
          });
      },
      error: (err) => this.output.set(JSON.stringify(err.error ?? err.message, null, 2)),
    });
  }

  toggleAccountEnabled(account: PublicAccount): void {
    this.api.adminGetWithEtag<AccountListing>(this.adminToken(), '/admin/accounts').subscribe({
      next: ({ body }) => {
        const version = body.version;
        this.api
          .adminWriteWithEtag<{ updated: true }>(
            this.adminToken(),
            'PUT',
            `/admin/mailboxes/${encodeURIComponent(account.id)}/enabled`,
            version,
            { enabled: !account.enabled },
          )
          .subscribe({
            next: () => {
              this.loadMailboxes();
              this.loadAccounts();
            },
            error: (err) => this.handle409OrError(err),
          });
      },
      error: (err) => this.output.set(JSON.stringify(err.error ?? err.message, null, 2)),
    });
  }

  toggleAiEnabled(account: PublicAccount): void {
    const version = this.accountsVersion();
    if (version === null) return;
    this.api
      .adminWriteWithEtag<AccountListing>(
        this.adminToken(),
        'PATCH',
        `/admin/accounts/${encodeURIComponent(account.id)}`,
        version,
        { aiEnabled: !account.aiEnabled },
      )
      .subscribe({
        next: ({ body }) => {
          this.accounts.set(body.accounts);
          this.accountsVersion.set(body.version);
          this.loadMailboxes();
          this.output.set(JSON.stringify(body, null, 2));
        },
        error: (err) => this.handle409OrError(err),
      });
  }

  deleteAccount(account: PublicAccount): void {
    const version = this.accountsVersion();
    if (version === null) return;
    this.api
      .adminWriteWithEtag<AccountListing>(
        this.adminToken(),
        'DELETE',
        `/admin/accounts/${encodeURIComponent(account.id)}`,
        version,
      )
      .subscribe({
        next: ({ body }) => {
          this.accounts.set(body.accounts);
          this.accountsVersion.set(body.version);
          this.loadMailboxes();
          this.prefillCreateForm(account);
          this.output.set(JSON.stringify(body, null, 2));
        },
        error: (err) => this.handle409OrError(err),
      });
  }

  createAccount(event: SubmitEvent): void {
    event.preventDefault();
    const version = this.accountsVersion();
    if (version === null) return;
    const form = event.target as HTMLFormElement;
    const read = (name: string) => (form.elements.namedItem(name) as HTMLInputElement).value;
    const readChecked = (name: string) =>
      (form.elements.namedItem(name) as HTMLInputElement).checked;
    const portRaw = read('imapPort').trim();
    const stateFolderRaw = read('stateFolder').trim();
    const body = {
      id: read('id'),
      imapHost: read('imapHost'),
      ...(portRaw !== '' ? { imapPort: Number(portRaw) } : {}),
      imapUser: read('imapUser'),
      imapPassword: read('imapPassword'),
      imapTls: readChecked('imapTls'),
      imapAllowInsecure: readChecked('imapAllowInsecure'),
      ...(stateFolderRaw !== '' ? { stateFolder: stateFolderRaw } : {}),
      enabled: readChecked('enabled'),
      aiEnabled: readChecked('aiEnabled'),
    };
    this.api
      .adminWriteWithEtag<AccountListing>(
        this.adminToken(),
        'POST',
        '/admin/accounts',
        version,
        body,
      )
      .subscribe({
        next: ({ body: listing }) => {
          this.accounts.set(listing.accounts);
          this.accountsVersion.set(listing.version);
          this.loadMailboxes();
          this.output.set(JSON.stringify(listing, null, 2));
          form.reset();
        },
        error: (err) => this.handle409OrError(err),
      });
  }

  /** Admin token → scoped mailbox JWT, then mailbox UI. */
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

  /** After delete, copy the removed account into the create form (no password)
   * so it can be re-added with edits. */
  private prefillCreateForm(account: PublicAccount): void {
    const form = this.createFormRef()?.nativeElement;
    if (!form) return;
    const setValue = (name: string, value: string) => {
      (form.elements.namedItem(name) as HTMLInputElement).value = value;
    };
    const setChecked = (name: string, checked: boolean) => {
      (form.elements.namedItem(name) as HTMLInputElement).checked = checked;
    };
    setValue('id', account.id);
    setValue('imapHost', account.imapHost);
    setValue('imapPort', String(account.imapPort));
    setValue('imapUser', account.imapUser);
    setValue('imapPassword', '');
    setValue('stateFolder', account.stateFolder);
    setChecked('imapTls', account.imapTls);
    setChecked('imapAllowInsecure', account.imapAllowInsecure);
    setChecked('enabled', account.enabled);
    setChecked('aiEnabled', account.aiEnabled);
    form.querySelector<HTMLInputElement>('input[name="imapPassword"]')?.focus();
  }

  /** A 409 means `accountsVersion()` is stale (another edit landed first) -
   * refresh the accounts list so the next mutation targets the current
   * version, rather than looping on the same stale `If-Match` forever. */
  private handle409OrError(err: { status?: number; error?: unknown; message?: string }): void {
    this.output.set(JSON.stringify(err.error ?? err.message, null, 2));
    if (err.status === 409) {
      this.loadAccounts();
    }
  }
}
