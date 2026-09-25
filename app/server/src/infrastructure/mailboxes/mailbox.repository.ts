import { Injectable } from '@nestjs/common';
import { MailboxConnectionConfig } from '../../config/app-config.js';
import type { Mailbox } from './mailbox.js';

/**
 * The server's mailbox registry (`server/mailbox-registry` spec): every
 * other part of the server discovers which mailboxes it manages through
 * `findAll()`, written against "the list of mailboxes" so it doesn't need to
 * change when the registry's source does.
 *
 * For this change, the registry is backed by the single env-configured
 * mailbox connection (`MailboxConnectionConfig`, injected via the `@Global`
 * `AppConfigModule`) and always returns exactly one mailbox. Callers must
 * treat the return value as an opaque list - not as "the env-backed mailbox"
 * - since a later change replaces this backing without touching callers.
 */
@Injectable()
export class MailboxRepository {
  constructor(private readonly connection: MailboxConnectionConfig) {}

  /**
   * Returns every mailbox the server manages. Currently always a single
   * entry, built from the injected connection config.
   */
  findAll(): Mailbox[] {
    return [
      {
        id: this.connection.id,
        imapHost: this.connection.imapHost,
        imapPort: this.connection.imapPort,
        imapUser: this.connection.imapUser,
        imapPassword: this.connection.imapPassword,
        imapTls: this.connection.imapTls,
        imapAllowInsecure: this.connection.imapAllowInsecure,
        stateFolder: this.connection.stateFolder,
      },
    ];
  }
}
