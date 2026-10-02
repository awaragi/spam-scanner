import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonFileAccountStore } from './json-file-account-store.js';
import { VersionConflict } from './account-store.js';
import type { AccountRecord } from './account-record.js';
import { ACCOUNTS_FILENAME } from '../../config/app-config.schema.js';
import { SpamScannerDataConfig } from '../../config/app-config.js';

function fixtureAccount(overrides: Partial<AccountRecord> = {}): AccountRecord {
  return {
    id: 'owner@example.com',
    imapHost: 'imap.example.com',
    imapPort: 993,
    imapUser: 'owner@example.com',
    imapPassword: 'secret',
    imapTls: true,
    imapAllowInsecure: false,
    stateFolder: 'INBOX.scanner.state',
    enabled: true,
    aiEnabled: true,
    ...overrides,
  };
}

describe('JsonFileAccountStore', () => {
  let dataDir: string;
  let dataConfig: SpamScannerDataConfig;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'spam-scanner-accounts-'));
    dataConfig = { path: dataDir } as SpamScannerDataConfig;
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  test('load() returns version 0 and an empty list when the file does not exist', async () => {
    const store = new JsonFileAccountStore(dataConfig);

    const file = await store.load();

    expect(file).toEqual({ version: 0, accounts: [] });
  });

  test('the first successful save creates the file, incrementing from version 0', async () => {
    const store = new JsonFileAccountStore(dataConfig);
    const account = fixtureAccount();

    const result = await store.save(0, [account]);

    expect(result).toEqual({ version: 1, accounts: [account] });

    const onDisk = JSON.parse(
      await readFile(join(dataDir, ACCOUNTS_FILENAME), 'utf-8'),
    );
    expect(onDisk).toEqual({ version: 1, accounts: [account] });
  });

  test('a save against a stale version throws VersionConflict and leaves the file unchanged', async () => {
    const store = new JsonFileAccountStore(dataConfig);
    const first = fixtureAccount();
    await store.save(0, [first]);

    const second = fixtureAccount({ id: 'second@example.com' });
    await expect(store.save(0, [first, second])).rejects.toThrow(
      VersionConflict,
    );

    const file = await store.load();
    expect(file).toEqual({ version: 1, accounts: [first] });
  });

  test('VersionConflict carries the current version', async () => {
    const store = new JsonFileAccountStore(dataConfig);
    await store.save(0, [fixtureAccount()]);

    await expect(store.save(0, [])).rejects.toMatchObject({
      currentVersion: 1,
    });
  });

  test('concurrent saves against the same starting version serialize: exactly one succeeds', async () => {
    const store = new JsonFileAccountStore(dataConfig);
    const a = fixtureAccount({ id: 'a@example.com' });
    const b = fixtureAccount({ id: 'b@example.com' });

    const results = await Promise.allSettled([
      store.save(0, [a]),
      store.save(0, [b]),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      VersionConflict,
    );

    const file = await store.load();
    expect(file.version).toBe(1);
  });

  test('a sequential save after a successful one, using the new version, succeeds', async () => {
    const store = new JsonFileAccountStore(dataConfig);
    const a = fixtureAccount({ id: 'a@example.com' });
    const first = await store.save(0, [a]);

    const b = fixtureAccount({ id: 'b@example.com' });
    const second = await store.save(first.version, [a, b]);

    expect(second).toEqual({ version: 2, accounts: [a, b] });
  });
});
