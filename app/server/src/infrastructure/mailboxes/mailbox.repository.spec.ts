import { describe, test, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import { MailboxConnectionConfig } from '../../config/app-config.js';
import { MailboxRepository } from './mailbox.repository.js';
import { rspamdUserFor } from './mailbox.js';

/**
 * Builds a fixture `MailboxConnectionConfig` without going through
 * `@nestjs/config`/env - `MailboxRepository` only depends on the section's
 * shape, so a plain object satisfies the type (see `config.module.spec.ts`
 * for the env-driven variant of this same section, used by `config/` tests
 * that exercise validation itself).
 */
function fixtureConnection(
  overrides: Partial<MailboxConnectionConfig> = {}
): MailboxConnectionConfig {
  return {
    id: 'owner@example.com',
    imapHost: 'imap.example.com',
    imapPort: 993,
    imapUser: 'owner@example.com',
    imapPassword: 'secret',
    imapTls: true,
    imapAllowInsecure: false,
    stateFolder: 'INBOX.scanner.state',
    ...overrides,
  };
}

async function buildRepository(
  connection: MailboxConnectionConfig
): Promise<MailboxRepository> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      MailboxRepository,
      { provide: MailboxConnectionConfig, useValue: connection },
    ],
  }).compile();

  return moduleRef.get(MailboxRepository);
}

describe('MailboxRepository', () => {
  test('findAll returns a list of exactly one mailbox, matching the injected config', async () => {
    const connection = fixtureConnection();
    const repository = await buildRepository(connection);

    const mailboxes = repository.findAll();

    expect(mailboxes).toHaveLength(1);
    expect(mailboxes[0]).toEqual({
      id: connection.id,
      imapHost: connection.imapHost,
      imapPort: connection.imapPort,
      imapUser: connection.imapUser,
      imapPassword: connection.imapPassword,
      imapTls: connection.imapTls,
      imapAllowInsecure: connection.imapAllowInsecure,
      stateFolder: connection.stateFolder,
    });
  });

  test('a bare-username IMAP login still results in the mailbox id being the separately-configured email, not derived from the IMAP login', async () => {
    const connection = fixtureConnection({
      // A bare username unrelated to MAILBOX_ID's email - e.g. a self-hosted
      // IMAP server that doesn't require an email-shaped login.
      imapUser: 'jdoe',
      id: 'jane.doe@example.com',
    });
    const repository = await buildRepository(connection);

    const [mailbox] = repository.findAll();

    expect(mailbox.id).toBe('jane.doe@example.com');
    expect(mailbox.imapUser).toBe('jdoe');
    expect(mailbox.id).not.toBe(mailbox.imapUser);
  });

  test('the rspamd user for a mailbox always equals its id', async () => {
    const connection = fixtureConnection({
      imapUser: 'jdoe',
      id: 'jane.doe@example.com',
    });
    const repository = await buildRepository(connection);

    const [mailbox] = repository.findAll();

    // rspamdUserFor is a pure function of mailbox.id - there is no separate
    // field it could read instead, so this can never diverge from id.
    expect(rspamdUserFor(mailbox)).toBe(mailbox.id);
    expect(rspamdUserFor(mailbox)).toBe('jane.doe@example.com');
    expect(rspamdUserFor(mailbox)).not.toBe(mailbox.imapUser);
  });
});
