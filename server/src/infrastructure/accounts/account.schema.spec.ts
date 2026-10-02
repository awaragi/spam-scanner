import { describe, test, expect } from 'vitest';
import { accountsFileSchema } from './account.schema.js';

/**
 * The example `accounts.json` an operator migrating from `MAILBOX_*` env
 * keys would hand-author for two legacy mailboxes (task 7.2 - see the
 * server README's "Mailbox accounts (accounts.json)" section for the same
 * example, kept in sync with this test by hand).
 */
const EXAMPLE_ACCOUNTS_FILE = {
  version: 1,
  accounts: [
    {
      id: 'owner@example.com',
      imapHost: 'imap.example.com',
      imapPort: 993,
      imapUser: 'owner@example.com',
      imapPassword: 'change-me',
      imapTls: true,
      imapAllowInsecure: false,
      stateFolder: 'INBOX.scanner.state',
      enabled: true,
      aiEnabled: true,
    },
    {
      id: 'second@example.com',
      imapHost: 'imap.example.com',
      imapPort: 993,
      imapUser: 'second@example.com',
      imapPassword: 'change-me-too',
      imapTls: true,
      imapAllowInsecure: false,
      stateFolder: 'INBOX.scanner.state',
      enabled: true,
      aiEnabled: false,
    },
  ],
};

describe('accountsFileSchema', () => {
  test('a hand-authored two-mailbox accounts.json example validates', () => {
    const result = accountsFileSchema.safeParse(EXAMPLE_ACCOUNTS_FILE);

    expect(result.success).toBe(true);
  });

  test('rejects an account id that is not shaped like an email address', () => {
    const result = accountsFileSchema.safeParse({
      version: 1,
      accounts: [{ ...EXAMPLE_ACCOUNTS_FILE.accounts[0], id: 'not-an-email' }],
    });

    expect(result.success).toBe(false);
  });

  test('rejects a negative version', () => {
    const result = accountsFileSchema.safeParse({
      ...EXAMPLE_ACCOUNTS_FILE,
      version: -1,
    });

    expect(result.success).toBe(false);
  });
});
