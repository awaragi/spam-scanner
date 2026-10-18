import { Component, computed, ElementRef, OnInit, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ApiService } from '../../core/api.service';
import { getAdminToken } from '../../core/auth-storage';
import { isEmailShaped } from '../../shared/email.util';
import { httpErrorMessage } from '../../shared/http-error.util';
import { NotifyService } from '../../shared/notify.service';

interface AccountListing {
  version: number;
  accounts: unknown[];
}

/** Prefill passed via router navigation state after a delete - see
 * `AdminComponent.deleteAccount`'s `router.navigate(..., { state })` call. */
interface PrefillAccount {
  id: string;
  imapUser: string;
  imapHost: string;
  imapPort: number;
  stateFolder: string;
  imapTls: boolean;
  imapAllowInsecure: boolean;
  enabled: boolean;
  aiEnabled: boolean;
}

@Component({
  selector: 'app-create-account',
  imports: [MatButtonModule, MatCardModule, MatCheckboxModule, MatFormFieldModule, MatInputModule],
  template: `
    <mat-card class="create-account-card">
      <mat-card-header>
        <mat-card-title>Create account</mat-card-title>
      </mat-card-header>
      <mat-card-content>
        <form #createForm class="create-form" (submit)="createAccount($event)">
          <mat-form-field appearance="outline">
            <mat-label>IMAP username</mat-label>
            <input
              matInput
              id="create-username"
              name="username"
              type="text"
              autocomplete="off"
              required
              (input)="onUsernameInput($event)"
            />
            <mat-hint>Used as the mailbox id too, when it's an email address.</mat-hint>
          </mat-form-field>
          @if (!usernameIsEmail()) {
            <mat-form-field appearance="outline">
              <mat-label>Email</mat-label>
              <input
                matInput
                id="create-email"
                name="email"
                type="email"
                required
                [value]="emailPrefill()"
              />
              <mat-hint
                >The IMAP username above isn't an email - used as the mailbox id instead.</mat-hint
              >
            </mat-form-field>
          }
          <mat-form-field appearance="outline">
            <mat-label>IMAP host</mat-label>
            <input matInput id="create-imapHost" name="imapHost" type="text" required />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>IMAP port</mat-label>
            <input matInput id="create-imapPort" name="imapPort" type="number" placeholder="993" />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>IMAP password</mat-label>
            <input
              matInput
              id="create-imapPassword"
              name="imapPassword"
              type="password"
              autocomplete="new-password"
              required
            />
          </mat-form-field>
          <mat-form-field appearance="outline">
            <mat-label>State folder</mat-label>
            <input
              matInput
              id="create-stateFolder"
              name="stateFolder"
              type="text"
              placeholder="INBOX.scanner.state"
            />
          </mat-form-field>
          <div class="checkbox-row">
            <mat-checkbox id="create-imapTls" name="imapTls" checked>IMAP TLS</mat-checkbox>
            <mat-checkbox id="create-imapAllowInsecure" name="imapAllowInsecure">
              Allow insecure
            </mat-checkbox>
            <mat-checkbox id="create-enabled" name="enabled" checked>
              Start runner after successful IMAP test
            </mat-checkbox>
            <mat-checkbox id="create-aiEnabled" name="aiEnabled" checked>AI enabled</mat-checkbox>
          </div>
          <div class="actions">
            <button type="button" mat-button (click)="cancel()">Cancel</button>
            <button type="submit" mat-flat-button>Create account</button>
          </div>
        </form>
      </mat-card-content>
    </mat-card>
  `,
  styles: [
    `
      .create-account-card {
        max-width: 40rem;
      }
      .create-form {
        display: flex;
        flex-direction: column;
      }
      .create-form mat-form-field {
        width: 100%;
        /* A hint that wraps to two lines (e.g. at phone width) needs more
           room than Material's default subscript area reserves, or it
           collides with the next field - pad instead of relying on that
           fixed-height area. */
        margin-bottom: 0.5rem;
      }
      .checkbox-row {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        margin: 0.5rem 0 1rem;
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.5rem;
      }
    `,
  ],
})
export class CreateAccountComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly notify = inject(NotifyService);

  private readonly createFormRef = viewChild<ElementRef<HTMLFormElement>>('createForm');

  private readonly username = signal('');
  readonly usernameIsEmail = computed(() => isEmailShaped(this.username()));
  /** Bound to the conditional email field's `[value]` so a prefill (task
   * 10.2's post-delete convenience) works regardless of whether that field
   * already exists in the DOM yet - signal-driven instead of a direct
   * `form.elements` write timed against the `@if`. */
  readonly emailPrefill = signal('');

  onUsernameInput(event: Event): void {
    this.username.set((event.target as HTMLInputElement).value);
  }

  ngOnInit(): void {
    const prefill = history.state?.prefillAccount as PrefillAccount | undefined;
    if (prefill) {
      this.prefill(prefill);
    }
  }

  private adminToken(): string {
    return getAdminToken() ?? '';
  }

  /** Same re-fetch-before-write pattern the rest of the account mutations on
   * `AdminComponent` use (see `toggleAiEnabled`'s doc comment there) - a
   * stale `If-Match` surfaces as a 409 rather than silently failing. */
  createAccount(event: SubmitEvent): void {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const read = (name: string) => (form.elements.namedItem(name) as HTMLInputElement).value;
    const readChecked = (name: string) =>
      (form.elements.namedItem(name) as HTMLInputElement).checked;
    const username = read('username');
    // Same rule as the id field used to be: an email-shaped username IS the
    // mailbox id (accountRecordSchema.id is z.email()); otherwise the
    // conditional "Email" field above supplies it (design.md D9).
    const id = isEmailShaped(username) ? username : read('email');
    const portRaw = read('imapPort').trim();
    const stateFolderRaw = read('stateFolder').trim();
    const body = {
      id,
      imapHost: read('imapHost'),
      ...(portRaw !== '' ? { imapPort: Number(portRaw) } : {}),
      imapUser: username,
      imapPassword: read('imapPassword'),
      imapTls: readChecked('imapTls'),
      imapAllowInsecure: readChecked('imapAllowInsecure'),
      ...(stateFolderRaw !== '' ? { stateFolder: stateFolderRaw } : {}),
      enabled: readChecked('enabled'),
      aiEnabled: readChecked('aiEnabled'),
    };
    this.api.adminGetWithEtag<AccountListing>(this.adminToken(), '/admin/accounts').subscribe({
      next: ({ body: current }) => {
        this.api
          .adminWriteWithEtag<AccountListing>(
            this.adminToken(),
            'POST',
            '/admin/accounts',
            current.version,
            body,
          )
          .subscribe({
            next: () => {
              this.notify.success(`${body.id} created.`);
              void this.router.navigate(['/admin']);
            },
            error: (err) => {
              this.notify.error(httpErrorMessage(err));
              if ((err as { status?: number }).status === 409) {
                this.notify.error('Accounts changed elsewhere - reload and try again.');
              }
            },
          });
      },
      error: (err) => this.notify.error(httpErrorMessage(err)),
    });
  }

  cancel(): void {
    void this.router.navigate(['/admin']);
  }

  private prefill(account: PrefillAccount): void {
    const form = this.createFormRef()?.nativeElement;
    if (!form) return;
    const setValue = (name: string, value: string) => {
      (form.elements.namedItem(name) as HTMLInputElement).value = value;
    };
    const setChecked = (name: string, checked: boolean) => {
      (form.elements.namedItem(name) as HTMLInputElement).checked = checked;
    };
    setValue('username', account.imapUser);
    this.username.set(account.imapUser);
    if (!isEmailShaped(account.imapUser)) {
      this.emailPrefill.set(account.id);
    }
    setValue('imapHost', account.imapHost);
    setValue('imapPort', String(account.imapPort));
    setValue('stateFolder', account.stateFolder);
    setChecked('imapTls', account.imapTls);
    setChecked('imapAllowInsecure', account.imapAllowInsecure);
    setChecked('enabled', account.enabled);
    setChecked('aiEnabled', account.aiEnabled);
    form.querySelector<HTMLInputElement>('input[name="imapPassword"]')?.focus();
  }
}
