import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ACCOUNTS_FILENAME } from '../../config/app-config.schema.js';
import { SpamScannerDataConfig } from '../../config/app-config.js';
import type { AccountRecord } from './account-record.js';
import { accountsFileSchema } from './account.schema.js';
import {
  AccountStore,
  VersionConflict,
  type AccountsFile,
} from './account-store.js';

function isEnoent(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

/**
 * The first (and, per design.md D2, so far only) `AccountStore`
 * implementation: a single JSON file at
 * `join(SpamScannerDataConfig.path, ACCOUNTS_FILENAME)` -
 * `server/mailbox-accounts` spec's "Account records are stored in a
 * versioned JSON file under SPAM_SCANNER_DATA" requirement.
 *
 * - Missing file → `{ version: 0, accounts: [] }` in memory; the first
 *   successful `save()` is what actually creates the file on disk.
 * - Every write goes to a temp file in the same directory, then `rename`s
 *   over the real path - a crash mid-write can never leave `accounts.json`
 *   truncated or half-written.
 * - `enqueue` serializes every `save()` call behind a single in-process
 *   promise chain (a process-wide mutex): the read-modify-write
 *   (`load()` → version check → `writeFile` → `rename`) for one call can
 *   never interleave with another's, so two concurrent `save()` calls
 *   against the same starting version can't both "win".
 */
@Injectable()
export class JsonFileAccountStore extends AccountStore {
  private readonly filePath: string;

  /** Every `save()` call chains onto this - see the class doc comment. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(dataConfig: SpamScannerDataConfig) {
    super();
    this.filePath = join(dataConfig.path, ACCOUNTS_FILENAME);
  }

  async load(): Promise<AccountsFile> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, 'utf-8');
    } catch (error) {
      if (isEnoent(error)) {
        return { version: 0, accounts: [] };
      }
      throw error;
    }
    return accountsFileSchema.parse(JSON.parse(raw));
  }

  async save(
    expectedVersion: number,
    accounts: readonly AccountRecord[],
  ): Promise<AccountsFile> {
    const run = this.queue.then(
      () => this.saveLocked(expectedVersion, accounts),
      () => this.saveLocked(expectedVersion, accounts),
    );
    // Swallow here so one failed save (a stale version, a disk error) never
    // permanently poisons the queue for every save after it.
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async saveLocked(
    expectedVersion: number,
    accounts: readonly AccountRecord[],
  ): Promise<AccountsFile> {
    const current = await this.load();
    if (current.version !== expectedVersion) {
      throw new VersionConflict(current.version);
    }

    const next: AccountsFile = { version: current.version + 1, accounts };
    await mkdir(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${randomUUID()}.tmp`;
    await writeFile(tempPath, JSON.stringify(next, null, 2) + '\n', 'utf-8');
    await rename(tempPath, this.filePath);
    return next;
  }
}
