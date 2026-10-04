import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { ApiService } from '../../core/api.service';
import { getMailboxToken } from '../../core/auth-storage';
import { httpErrorMessage } from '../../shared/http-error.util';
import { NotifyService } from '../../shared/notify.service';
import { parseAddressList } from './sender-list.util';

export type SenderListKind = 'whitelist' | 'blacklist';

@Component({
  selector: 'app-sender-list-panel',
  imports: [FormsModule, MatButtonModule, MatCardModule, MatIconModule],
  template: `
    <mat-card class="list-panel">
      <mat-card-header>
        <mat-card-title>{{ kind }}</mat-card-title>
        <mat-card-subtitle>{{ addresses().length }} address(es)</mat-card-subtitle>
      </mat-card-header>
      <mat-card-content>
        <textarea
          [(ngModel)]="editorText"
          rows="12"
          class="editor"
          [attr.aria-label]="kind + ' addresses'"
        ></textarea>
      </mat-card-content>
      <mat-card-actions>
        <button type="button" mat-button (click)="reload()">
          <mat-icon>refresh</mat-icon>
          Reload
        </button>
        <button type="button" mat-button (click)="save()">
          <mat-icon>save</mat-icon>
          Save
        </button>
        <button type="button" mat-button (click)="fileInput.click()">
          <mat-icon>upload_file</mat-icon>
          Import…
        </button>
        <button type="button" mat-button (click)="exportJson()">
          <mat-icon>download</mat-icon>
          Export JSON
        </button>
        <button type="button" mat-button (click)="exportLines()">
          <mat-icon>download</mat-icon>
          Export lines
        </button>
        <input
          #fileInput
          type="file"
          accept=".txt,.json,text/plain,application/json"
          hidden
          (change)="onFileSelected($event)"
        />
      </mat-card-actions>
    </mat-card>
  `,
  styles: [
    `
      .list-panel {
        margin-bottom: 1.5rem;
      }
      .editor {
        width: 100%;
        box-sizing: border-box;
        font-family: monospace;
      }
      mat-card-actions {
        display: flex;
        flex-wrap: wrap;
      }
    `,
  ],
})
export class SenderListPanelComponent implements OnInit {
  @Input({ required: true }) mailboxId!: string;
  @Input({ required: true }) kind!: SenderListKind;

  private readonly api = inject(ApiService);
  private readonly notify = inject(NotifyService);

  readonly addresses = signal<string[]>([]);
  editorText = '';

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.api.mailboxGet<string[]>(this.token(), this.mailboxId, `/lists/${this.kind}`).subscribe({
      next: (list) => {
        this.addresses.set(list);
        this.editorText = list.join('\n');
      },
      error: (err) => this.notify.error(httpErrorMessage(err, `Could not load ${this.kind}.`)),
    });
  }

  save(): void {
    let parsed: string[];
    try {
      parsed = parseAddressList(this.editorText);
    } catch (err) {
      this.notify.error(err instanceof Error ? err.message : String(err));
      return;
    }
    this.api
      .mailboxPut<{ replaced: true }>(this.token(), this.mailboxId, `/lists/${this.kind}`, parsed)
      .subscribe({
        next: () => {
          this.addresses.set(parsed);
          this.notify.success(`${this.kind} saved.`);
        },
        error: (err) => this.notify.error(httpErrorMessage(err, `Could not save ${this.kind}.`)),
      });
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    file
      .text()
      .then((text) => {
        let parsed: string[];
        try {
          parsed = parseAddressList(text);
        } catch (err) {
          this.notify.error(err instanceof Error ? err.message : String(err));
          return;
        }
        this.api
          .mailboxPost<{ imported: true }>(
            this.token(),
            this.mailboxId,
            `/lists/${this.kind}/import`,
            parsed,
          )
          .subscribe({
            next: () => {
              this.addresses.set(parsed);
              this.editorText = parsed.join('\n');
              this.notify.success(`Imported ${parsed.length} address(es).`);
            },
            error: (err) =>
              this.notify.error(httpErrorMessage(err, `Could not import ${this.kind}.`)),
          });
      })
      .catch((err) => this.notify.error(String(err)));
  }

  exportJson(): void {
    this.fetchExport((list) =>
      this.downloadFile(`${this.kind}.json`, JSON.stringify(list, null, 2)),
    );
  }

  exportLines(): void {
    this.fetchExport((list) =>
      this.downloadFile(`${this.kind}.txt`, list.join('\n') + (list.length ? '\n' : '')),
    );
  }

  private fetchExport(write: (list: string[]) => void): void {
    this.api
      .mailboxGet<string[]>(this.token(), this.mailboxId, `/lists/${this.kind}/export`)
      .subscribe({
        next: (list) => {
          this.addresses.set(list);
          write(list);
          this.notify.success(`Exported ${list.length} address(es).`);
        },
        error: (err) => this.notify.error(httpErrorMessage(err, `Could not export ${this.kind}.`)),
      });
  }

  private downloadFile(filename: string, content: string): void {
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  private token(): string {
    return getMailboxToken() ?? '';
  }
}
