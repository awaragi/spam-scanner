import { Module } from '@nestjs/common';
import { AccountStore } from './account-store.js';
import { JsonFileAccountStore } from './json-file-account-store.js';

/**
 * Binds the `AccountStore` port to its first (JSON file) implementation -
 * `server/mailbox-accounts` design.md D2. Swapping storage later is a new
 * `@Injectable()` implementing `AccountStore` plus changing this one
 * binding; every consumer (`MailboxRepository`, `AccountAdminService`, ...)
 * depends on `AccountStore` and never on `JsonFileAccountStore` directly.
 */
@Module({
  providers: [{ provide: AccountStore, useClass: JsonFileAccountStore }],
  exports: [AccountStore],
})
export class AccountsModule {}
