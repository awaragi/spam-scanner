import { Injectable } from '@nestjs/common';
import { MailboxConnectionsConfig } from '../../config/app-config.js';
import type { Mailbox } from './mailbox.js';

/**
 * The server's mailbox registry (`server/mailbox-registry` spec): every
 * other part of the server discovers which mailboxes it manages through
 * `findAll()`, written against "the list of mailboxes" so it doesn't need to
 * change when the registry's source does.
 *
 * For this change, the registry is backed by the env-configured mailbox
 * connections (`MailboxConnectionsConfig`, injected via the `@Global`
 * `AppConfigModule`) - one to `MAILBOX_MAX_COUNT` mailboxes, numbered
 * `MAILBOX_1_*`, `MAILBOX_2_*`, .... Callers must treat the return value as
 * an opaque list - not as "the env-backed mailboxes" - since a later change
 * replaces this backing without touching callers.
 */
@Injectable()
export class MailboxRepository {
  constructor(private readonly connections: MailboxConnectionsConfig) {}

  /**
   * Returns every mailbox the server manages, built from the injected
   * connection configs.
   */
  findAll(): Mailbox[] {
    return this.connections.mailboxes.map((connection) => ({
      id: connection.id,
      imapHost: connection.imapHost,
      imapPort: connection.imapPort,
      imapUser: connection.imapUser,
      imapPassword: connection.imapPassword,
      imapTls: connection.imapTls,
      imapAllowInsecure: connection.imapAllowInsecure,
      stateFolder: connection.stateFolder,
      enabled: connection.enabled,
    }));
  }
}
