import { Component, Input, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/api.service';
import { getMailboxToken } from '../../core/auth-storage';
import { parseAddressList } from './sender-list.util';

export type SenderListKind = 'whitelist' | 'blacklist';

@Component({
  selector: 'app-sender-list-panel',
  imports: [FormsModule],
  template: `
    <section>
      <h3>{{ kind }}</h3>
      <p>
        <button type="button" (click)="reload()">Reload</button>
        <button type="button" (click)="save()">Save (PUT)</button>
        <button type="button" (click)="fileInput.click()">Import (.txt or .json)…</button>
        <button type="button" (click)="exportJson()">Export JSON</button>
        <button type="button" (click)="exportLines()">Export lines</button>
        <input
          #fileInput
          type="file"
          accept=".txt,.json,text/plain,application/json"
          hidden
          (change)="onFileSelected($event)"
        />
      </p>
      <p>{{ addresses().length }} address(es)</p>
      <textarea
        [(ngModel)]="editorText"
        rows="12"
        cols="60"
        [attr.aria-label]="kind + ' addresses'"
      ></textarea>
      @if (message()) {
        <pre>{{ message() }}</pre>
      }
    </section>
  `,
})
export class SenderListPanelComponent implements OnInit {
  @Input({ required: true }) mailboxId!: string;
  @Input({ required: true }) kind!: SenderListKind;

  private readonly api = inject(ApiService);

  readonly addresses = signal<string[]>([]);
  editorText = '';
  readonly message = signal('');

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.message.set('');
    this.api
      .mailboxGet<string[]>(this.token(), this.mailboxId, `/lists/${this.kind}`)
      .subscribe({
        next: (list) => {
          this.addresses.set(list);
          this.editorText = list.join('\n');
        },
        error: (err) =>
          this.message.set(JSON.stringify(err.error ?? err.message, null, 2)),
      });
  }

  save(): void {
    this.message.set('');
    let parsed: string[];
    try {
      parsed = parseAddressList(this.editorText);
    } catch (err) {
      this.message.set(err instanceof Error ? err.message : String(err));
      return;
    }
    this.api
      .mailboxPut<{ replaced: true }>(
        this.token(),
        this.mailboxId,
        `/lists/${this.kind}`,
        parsed,
      )
      .subscribe({
        next: () => {
          this.addresses.set(parsed);
          this.message.set('Saved.');
        },
        error: (err) =>
          this.message.set(JSON.stringify(err.error ?? err.message, null, 2)),
      });
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    this.message.set('');
    file
      .text()
      .then((text) => {
        let parsed: string[];
        try {
          parsed = parseAddressList(text);
        } catch (err) {
          this.message.set(err instanceof Error ? err.message : String(err));
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
              this.message.set(`Imported ${parsed.length} address(es).`);
            },
            error: (err) =>
              this.message.set(JSON.stringify(err.error ?? err.message, null, 2)),
          });
      })
      .catch((err) => this.message.set(String(err)));
  }

  exportJson(): void {
    this.fetchExport((list) => this.downloadFile(`${this.kind}.json`, JSON.stringify(list, null, 2)));
  }

  exportLines(): void {
    this.fetchExport((list) => this.downloadFile(`${this.kind}.txt`, list.join('\n') + (list.length ? '\n' : '')));
  }

  private fetchExport(write: (list: string[]) => void): void {
    this.message.set('');
    this.api
      .mailboxGet<string[]>(
        this.token(),
        this.mailboxId,
        `/lists/${this.kind}/export`,
      )
      .subscribe({
        next: (list) => {
          this.addresses.set(list);
          write(list);
          this.message.set(`Exported ${list.length} address(es).`);
        },
        error: (err) =>
          this.message.set(JSON.stringify(err.error ?? err.message, null, 2)),
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
