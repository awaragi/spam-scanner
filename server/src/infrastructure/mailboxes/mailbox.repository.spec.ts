import { describe, test, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import { AccountStore, type AccountsFile } from '../accounts/account-store.js';
import type { AccountRecord } from '../accounts/account-record.js';
import { MailboxRepository } from './mailbox.repository.js';
import { rspamdUserFor } from './mailbox.js';

/**
 * A fake `AccountStore` whose `load()` always returns a fixed file - the
 * same substitution-by-fake-adapter pattern used throughout
 * `infrastructure/` (see CLAUDE.md). `MailboxRepository` only ever calls
 * `load()`, never `save()`.
 */
function fakeAccountStore(accounts: AccountRecord[]): AccountStore {
  return {
    load: () => Promise.resolve({ version: 1, accounts } as AccountsFile),
    save: () => {
      throw new Error('not used by MailboxRepository');
    },
  } as AccountStore;
}

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

async function buildRepository(
  accounts: AccountRecord[],
): Promise<MailboxRepository> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      MailboxRepository,
      { provide: AccountStore, useValue: fakeAccountStore(accounts) },
    ],
  }).compile();

  return moduleRef.get(MailboxRepository);
}

describe('MailboxRepository', () => {
  test('maps enabled: false from the account record onto Mailbox', async () => {
    const repository = await buildRepository([
      fixtureAccount({ enabled: false }),
    ]);

    const mailboxes = await repository.findAll();

    expect(mailboxes[0]?.enabled).toBe(false);
  });

  test('maps aiEnabled from the account record onto Mailbox', async () => {
    const repository = await buildRepository([
      fixtureAccount({ aiEnabled: false }),
    ]);

    const mailboxes = await repository.findAll();

    expect(mailboxes[0]?.aiEnabled).toBe(false);
  });

  test('findAll returns a list of exactly one mailbox, matching the stored account', async () => {
    const account = fixtureAccount();
    const repository = await buildRepository([account]);

    const mailboxes = await repository.findAll();

    expect(mailboxes).toHaveLength(1);
    expect(mailboxes[0]).toEqual(account);
  });

  test('findAll returns every stored account, in file order', async () => {
    const first = fixtureAccount({ id: 'first@example.com' });
    const second = fixtureAccount({
      id: 'second@example.com',
      imapHost: 'imap.other.example.com',
      imapPort: 143,
      imapUser: 'jdoe',
      imapPassword: 'secret-2',
      imapTls: false,
      imapAllowInsecure: true,
    });
    const repository = await buildRepository([first, second]);

    const mailboxes = await repository.findAll();

    expect(mailboxes).toHaveLength(2);
    expect(mailboxes[0]).toEqual(first);
    expect(mailboxes[1]).toEqual(second);
  });

  test('reflects a changed account list on the next call, with no caching', async () => {
    const accounts = [fixtureAccount({ id: 'first@example.com' })];
    const store: AccountStore = {
      load: () => Promise.resolve({ version: 1, accounts }),
      save: () => {
        throw new Error('not used');
      },
    } as AccountStore;
    const moduleRef = await Test.createTestingModule({
      providers: [
        MailboxRepository,
        { provide: AccountStore, useValue: store },
      ],
    }).compile();
    const repository = moduleRef.get(MailboxRepository);

    expect(await repository.findAll()).toHaveLength(1);

    accounts.push(fixtureAccount({ id: 'second@example.com' }));

    expect(await repository.findAll()).toHaveLength(2);
  });

  test('a bare-username IMAP login still results in the mailbox id being the separately-configured email, not derived from the IMAP login', async () => {
    const repository = await buildRepository([
      fixtureAccount({
        id: 'jane.doe@example.com',
        // A bare username unrelated to id's email - e.g. a self-hosted IMAP
        // server that doesn't require an email-shaped login.
        imapUser: 'jdoe',
      }),
    ]);

    const [mailbox] = await repository.findAll();

    expect(mailbox.id).toBe('jane.doe@example.com');
    expect(mailbox.imapUser).toBe('jdoe');
    expect(mailbox.id).not.toBe(mailbox.imapUser);
  });

  test('the rspamd user for a mailbox always equals its id', async () => {
    const repository = await buildRepository([
      fixtureAccount({ id: 'jane.doe@example.com', imapUser: 'jdoe' }),
    ]);

    const [mailbox] = await repository.findAll();

    // rspamdUserFor is a pure function of mailbox.id - there is no separate
    // field it could read instead, so this can never diverge from id.
    expect(rspamdUserFor(mailbox)).toBe(mailbox.id);
    expect(rspamdUserFor(mailbox)).toBe('jane.doe@example.com');
    expect(rspamdUserFor(mailbox)).not.toBe(mailbox.imapUser);
  });
});
