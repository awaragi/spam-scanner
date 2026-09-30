import { describe, test, expect } from 'vitest';
import { Test } from '@nestjs/testing';
import { MailboxConnectionsConfig } from '../../config/app-config.js';
import { MailboxRepository } from './mailbox.repository.js';
import { rspamdUserFor } from './mailbox.js';

/**
 * Builds a fixture `MailboxConnectionsConfig` without going through
 * `@nestjs/config`/env - `MailboxRepository` only depends on the section's
 * shape, so a plain object satisfies the type (see `config.module.spec.ts`
 * for the env-driven variant of this same section, used by `config/` tests
 * that exercise validation itself).
 */
function fixtureConnections(
  mailboxes: MailboxConnectionsConfig['mailboxes'] = [
    {
      id: 'owner@example.com',
      imapHost: 'imap.example.com',
      imapPort: 993,
      imapUser: 'owner@example.com',
      imapPassword: 'secret',
      imapTls: true,
      imapAllowInsecure: false,
      stateFolder: 'INBOX.scanner.state',
      enabled: true,
    },
  ],
): MailboxConnectionsConfig {
  return { mailboxes };
}

async function buildRepository(
  connections: MailboxConnectionsConfig,
): Promise<MailboxRepository> {
  const moduleRef = await Test.createTestingModule({
    providers: [
      MailboxRepository,
      { provide: MailboxConnectionsConfig, useValue: connections },
    ],
  }).compile();

  return moduleRef.get(MailboxRepository);
}

describe('MailboxRepository', () => {
  test('maps enabled: false from the connection config onto Mailbox', async () => {
    const connections = fixtureConnections([
      {
        id: 'owner@example.com',
        imapHost: 'imap.example.com',
        imapPort: 993,
        imapUser: 'owner@example.com',
        imapPassword: 'secret',
        imapTls: true,
        imapAllowInsecure: false,
        stateFolder: 'INBOX.scanner.state',
        enabled: false,
      },
    ]);
    const repository = await buildRepository(connections);

    expect(repository.findAll()[0]?.enabled).toBe(false);
  });

  test('findAll returns a list of exactly one mailbox, matching the injected config', async () => {
    const connections = fixtureConnections();
    const repository = await buildRepository(connections);

    const mailboxes = repository.findAll();

    expect(mailboxes).toHaveLength(1);
    expect(mailboxes[0]).toEqual(connections.mailboxes[0]);
  });

  test('findAll returns every configured mailbox, in slot order', async () => {
    const connections = fixtureConnections([
      {
        id: 'first@example.com',
        imapHost: 'imap.example.com',
        imapPort: 993,
        imapUser: 'first@example.com',
        imapPassword: 'secret-1',
        imapTls: true,
        imapAllowInsecure: false,
        stateFolder: 'INBOX.scanner.state',
    enabled: true,
      },
      {
        id: 'second@example.com',
        imapHost: 'imap.other.example.com',
        imapPort: 143,
        imapUser: 'jdoe',
        imapPassword: 'secret-2',
        imapTls: false,
        imapAllowInsecure: true,
        stateFolder: 'INBOX.scanner.state',
    enabled: true,
      },
    ]);
    const repository = await buildRepository(connections);

    const mailboxes = repository.findAll();

    expect(mailboxes).toHaveLength(2);
    expect(mailboxes[0]).toEqual(connections.mailboxes[0]);
    expect(mailboxes[1]).toEqual(connections.mailboxes[1]);
  });

  test('a bare-username IMAP login still results in the mailbox id being the separately-configured email, not derived from the IMAP login', async () => {
    const connections = fixtureConnections([
      {
        id: 'jane.doe@example.com',
        imapHost: 'imap.example.com',
        imapPort: 993,
        // A bare username unrelated to id's email - e.g. a self-hosted IMAP
        // server that doesn't require an email-shaped login.
        imapUser: 'jdoe',
        imapPassword: 'secret',
        imapTls: true,
        imapAllowInsecure: false,
        stateFolder: 'INBOX.scanner.state',
    enabled: true,
      },
    ]);
    const repository = await buildRepository(connections);

    const [mailbox] = repository.findAll();

    expect(mailbox.id).toBe('jane.doe@example.com');
    expect(mailbox.imapUser).toBe('jdoe');
    expect(mailbox.id).not.toBe(mailbox.imapUser);
  });

  test('the rspamd user for a mailbox always equals its id', async () => {
    const connections = fixtureConnections([
      {
        id: 'jane.doe@example.com',
        imapHost: 'imap.example.com',
        imapPort: 993,
        imapUser: 'jdoe',
        imapPassword: 'secret',
        imapTls: true,
        imapAllowInsecure: false,
        stateFolder: 'INBOX.scanner.state',
    enabled: true,
      },
    ]);
    const repository = await buildRepository(connections);

    const [mailbox] = repository.findAll();

    // rspamdUserFor is a pure function of mailbox.id - there is no separate
    // field it could read instead, so this can never diverge from id.
    expect(rspamdUserFor(mailbox)).toBe(mailbox.id);
    expect(rspamdUserFor(mailbox)).toBe('jane.doe@example.com');
    expect(rspamdUserFor(mailbox)).not.toBe(mailbox.imapUser);
  });
});
