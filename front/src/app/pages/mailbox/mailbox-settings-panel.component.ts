import { Component, OnInit, inject, signal } from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';

/** `Validators.required` wrapped as an arrow function - oxlint's
 * `unbound-method` rule flags passing the bare static method reference. */
const required = (control: AbstractControl): ValidationErrors | null =>
  Validators.required(control);
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ApiService } from '../../core/api.service';
import { getMailboxId, getMailboxToken } from '../../core/auth-storage';
import { httpErrorMessage } from '../../shared/http-error.util';
import { NotifyService } from '../../shared/notify.service';
import {
  SETTINGS_SECTIONS,
  buildSettingsOverrideBody,
  sectionsWithOverride,
} from './mailbox-settings.util';

/** The overridable subset of `MailboxSettings` this form edits - mirrors
 * `server/src/config/mailbox-settings.schema.ts`'s `overridableSchema`
 * exactly. `aiEnabled` is deliberately absent: `PUT .../settings` rejects it
 * outright (it's admin-only, set through the account API). */
interface MailboxSettings {
  folders: {
    inbox: string;
    spam: string;
    spamLow: string;
    spamHigh: string;
    trainSpam: string;
    trainHam: string;
    trainWhitelist: string;
    trainBlacklist: string;
  };
  scanRead: boolean;
  scanInitialState: 'new' | 'all';
  processingMode: 'label' | 'folder';
  labels: {
    spamLow: string;
    spamHigh: string;
  };
  thresholds: {
    clean: number;
    low: number;
    confirmed: number;
  };
  aiEscalation: {
    toLowThreshold: number;
    toHighThreshold: number;
  };
}

/** `GET .../settings`'s response shape (design.md, "settings override vs.
 * default" change): the resolved settings (always fully populated, whether
 * a given key is an actual override or just its code default), alongside
 * which top-level keys currently have a stored override - otherwise every
 * field looks pinned-in-place the moment settings are opened, since the
 * resolved values alone can't be told apart from defaults. */
interface MailboxSettingsResponse {
  settings: MailboxSettings;
  overriddenKeys: string[];
}

@Component({
  selector: 'app-mailbox-settings-panel',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatCheckboxModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatSelectModule,
  ],
  template: `
    <a mat-button [routerLink]="['/mailbox', mailboxId]">
      <mat-icon>arrow_back</mat-icon>
      Back to mailbox
    </a>
    <h1>Settings</h1>
    @if (form) {
      <form [formGroup]="form" (ngSubmit)="save()">
        <mat-accordion multi>
          <mat-expansion-panel>
            <mat-expansion-panel-header>Folders</mat-expansion-panel-header>
            <mat-checkbox
              [checked]="isOverridden('folders')"
              (change)="setOverridden('folders', $event.checked)"
            >
              Override defaults
            </mat-checkbox>
            <div formGroupName="folders" class="field-grid">
              @for (name of folderFields; track name) {
                <mat-form-field appearance="outline">
                  <mat-label>{{ name }}</mat-label>
                  <input matInput [formControlName]="name" />
                </mat-form-field>
              }
            </div>
          </mat-expansion-panel>

          <mat-expansion-panel>
            <mat-expansion-panel-header>Scanning behavior</mat-expansion-panel-header>
            <mat-checkbox
              [checked]="isOverridden('scanning')"
              (change)="setOverridden('scanning', $event.checked)"
            >
              Override defaults
            </mat-checkbox>
            <mat-checkbox formControlName="scanRead"> Scan already-read messages too </mat-checkbox>
            <mat-form-field appearance="outline">
              <mat-label>Unscanned mailbox scans first</mat-label>
              <mat-select formControlName="scanInitialState">
                <mat-option value="new">New messages only</mat-option>
                <mat-option value="all">All messages</mat-option>
              </mat-select>
            </mat-form-field>
          </mat-expansion-panel>

          <mat-expansion-panel>
            <mat-expansion-panel-header>Processing mode</mat-expansion-panel-header>
            <mat-checkbox
              [checked]="isOverridden('processingMode')"
              (change)="setOverridden('processingMode', $event.checked)"
            >
              Override defaults
            </mat-checkbox>
            <mat-form-field appearance="outline">
              <mat-label>Mode</mat-label>
              <mat-select formControlName="processingMode">
                <mat-option value="folder">Move to spam-likelihood folders</mat-option>
                <mat-option value="label">Label in place</mat-option>
              </mat-select>
            </mat-form-field>
            <div formGroupName="labels" class="field-grid">
              <mat-form-field appearance="outline">
                <mat-label>Low-confidence label</mat-label>
                <input matInput formControlName="spamLow" />
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>High-confidence label</mat-label>
                <input matInput formControlName="spamHigh" />
              </mat-form-field>
            </div>
          </mat-expansion-panel>

          <mat-expansion-panel>
            <mat-expansion-panel-header>Thresholds</mat-expansion-panel-header>
            <mat-checkbox
              [checked]="isOverridden('thresholds')"
              (change)="setOverridden('thresholds', $event.checked)"
            >
              Override defaults
            </mat-checkbox>
            <div formGroupName="thresholds" class="field-grid">
              <mat-form-field appearance="outline">
                <mat-label>Clean</mat-label>
                <input matInput type="number" formControlName="clean" />
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>Low</mat-label>
                <input matInput type="number" formControlName="low" />
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>Confirmed</mat-label>
                <input matInput type="number" formControlName="confirmed" />
              </mat-form-field>
            </div>
          </mat-expansion-panel>

          <mat-expansion-panel>
            <mat-expansion-panel-header>AI escalation</mat-expansion-panel-header>
            <mat-checkbox
              [checked]="isOverridden('aiEscalation')"
              (change)="setOverridden('aiEscalation', $event.checked)"
            >
              Override defaults
            </mat-checkbox>
            <div formGroupName="aiEscalation" class="field-grid">
              <mat-form-field appearance="outline">
                <mat-label>Escalate to low threshold</mat-label>
                <input matInput type="number" formControlName="toLowThreshold" />
              </mat-form-field>
              <mat-form-field appearance="outline">
                <mat-label>Escalate to high threshold</mat-label>
                <input matInput type="number" formControlName="toHighThreshold" />
              </mat-form-field>
            </div>
          </mat-expansion-panel>
        </mat-accordion>

        <div class="actions">
          <button type="submit" mat-flat-button [disabled]="form.invalid || saving">
            Save settings
          </button>
        </div>
      </form>
    } @else {
      <p>Loading settings…</p>
    }
  `,
  styles: [
    `
      h1 {
        margin-top: 0.5rem;
      }
      .field-grid {
        display: flex;
        flex-direction: column;
        padding: 0.5rem 0;
      }
      .field-grid mat-form-field {
        width: 100%;
      }
      mat-checkbox {
        display: block;
        margin: 0.5rem 0;
      }
      .actions {
        display: flex;
        justify-content: flex-end;
        margin-top: 1rem;
      }
    `,
  ],
})
export class MailboxSettingsPanelComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly notify = inject(NotifyService);
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);

  /** Same fallback pattern as `MailboxComponent` - a route param, falling
   * back to the mailbox-scoped session, since this is now reached directly
   * as the `mailbox/:id/settings` route rather than taking it as an
   * `@Input` from a parent that embedded it. */
  mailboxId = '';

  readonly folderFields = [
    'inbox',
    'spam',
    'spamLow',
    'spamHigh',
    'trainSpam',
    'trainHam',
    'trainWhitelist',
    'trainBlacklist',
  ] as const;

  saving = false;
  form: ReturnType<typeof this.buildForm> | null = null;

  /** Which sections currently have a real stored override (vs. showing
   * their code default) - drives both each checkbox's checked state and
   * whether that section's controls are enabled/disabled. A disabled
   * `FormGroup`/control is excluded from `this.form.value` by Angular's own
   * reactive-forms behavior, so `save()` needs no separate filtering: it
   * already submits only the overridden sections' data. */
  private readonly overridden = signal<ReadonlySet<string>>(new Set());

  isOverridden(sectionId: string): boolean {
    return this.overridden().has(sectionId);
  }

  setOverridden(sectionId: string, checked: boolean): void {
    const next = new Set(this.overridden());
    if (checked) {
      next.add(sectionId);
    } else {
      next.delete(sectionId);
    }
    this.overridden.set(next);
    this.applyOverrideState();
  }

  ngOnInit(): void {
    this.mailboxId = this.route.snapshot.paramMap.get('id') ?? getMailboxId() ?? '';
    this.form = this.buildForm();
    this.reload();
  }

  private buildForm() {
    return this.fb.nonNullable.group({
      folders: this.fb.nonNullable.group({
        inbox: ['', required],
        spam: ['', required],
        spamLow: ['', required],
        spamHigh: ['', required],
        trainSpam: ['', required],
        trainHam: ['', required],
        trainWhitelist: ['', required],
        trainBlacklist: ['', required],
      }),
      scanRead: [false],
      scanInitialState: this.fb.nonNullable.control<'new' | 'all'>('new'),
      processingMode: this.fb.nonNullable.control<'label' | 'folder'>('folder'),
      labels: this.fb.nonNullable.group({
        spamLow: ['', required],
        spamHigh: ['', required],
      }),
      thresholds: this.fb.nonNullable.group({
        clean: [0, required],
        low: [0, required],
        confirmed: [0, required],
      }),
      aiEscalation: this.fb.nonNullable.group({
        toLowThreshold: [0, required],
        toHighThreshold: [0, required],
      }),
    });
  }

  private token(): string {
    return getMailboxToken() ?? '';
  }

  reload(): void {
    this.api
      .mailboxGet<MailboxSettingsResponse>(this.token(), this.mailboxId, '/settings')
      .subscribe({
        next: ({ settings, overriddenKeys }) => {
          this.form?.patchValue(settings);
          this.overridden.set(sectionsWithOverride(overriddenKeys));
          this.applyOverrideState();
        },
        error: (err) => this.notify.error(httpErrorMessage(err, 'Could not load settings.')),
      });
  }

  /** Enables each section's form controls when its checkbox is on (so they
   * can be edited), disables them otherwise (read-only, showing the current
   * - i.e. default - resolved value). Also drives `.invalid`, which
   * correctly ignores disabled controls' validators - unlike `.value`
   * (see `buildSettingsOverrideBody`'s doc comment), form validity status
   * *does* exclude disabled controls as documented. */
  private applyOverrideState(): void {
    if (!this.form) return;
    for (const section of SETTINGS_SECTIONS) {
      const enabled = this.isOverridden(section.id);
      for (const key of section.keys) {
        const control = this.form.get(key);
        if (!control) continue;
        if (enabled) {
          control.enable({ emitEvent: false });
        } else {
          control.disable({ emitEvent: false });
        }
      }
    }
  }

  save(): void {
    if (!this.form || this.form.invalid) return;
    this.saving = true;
    const body = buildSettingsOverrideBody(this.form.getRawValue(), this.overridden());
    this.api
      .mailboxPut<{ updated: true }>(this.token(), this.mailboxId, '/settings', body)
      .subscribe({
        next: () => {
          this.saving = false;
          this.notify.success('Settings saved.');
          this.reload();
        },
        error: (err) => {
          this.saving = false;
          this.notify.error(httpErrorMessage(err, 'Could not save settings.'));
        },
      });
  }
}
