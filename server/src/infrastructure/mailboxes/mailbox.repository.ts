import { Injectable } from '@nestjs/common';
import { AccountStore } from '../accounts/account-store.js';
import type { Mailbox } from './mailbox.js';

/**
 * The server's mailbox registry (`server/mailbox-registry` spec): every
 * other part of the server discovers which mailboxes it manages through
 * `findAll()`, written against "the list of mailboxes" so it doesn't need to
 * change when the registry's source does.
 *
 * Backed by the durable `AccountStore` (`persistent-mailbox-accounts`
 * design.md D2/D5) - `findAll()` reads through the store on every call
 * (never cached here), so an account added, updated, or removed at runtime
 * is reflected immediately without a server restart, per the
 * `server/mailbox-registry` spec's "An account is added at runtime"
 * scenario.
 */
@Injectable()
export class MailboxRepository {
  constructor(private readonly accountStore: AccountStore) {}

  /**
   * Returns every mailbox the server manages, mapped from the account
   * store's current records.
   */
  async findAll(): Promise<Mailbox[]> {
    const { accounts } = await this.accountStore.load();
    return accounts.map((account) => ({
      id: account.id,
      imapHost: account.imapHost,
      imapPort: account.imapPort,
      imapUser: account.imapUser,
      imapPassword: account.imapPassword,
      imapTls: account.imapTls,
      imapAllowInsecure: account.imapAllowInsecure,
      stateFolder: account.stateFolder,
      enabled: account.enabled,
      aiEnabled: account.aiEnabled,
    }));
  }
}
