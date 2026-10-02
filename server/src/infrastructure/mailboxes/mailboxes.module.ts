import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module.js';
import { MailboxRepository } from './mailbox.repository.js';

/**
 * Provides `MailboxRepository`, the mailbox registry backed by the durable
 * `AccountStore` (see the `server/mailbox-registry` spec).
 * `AccountsModule` supplies that store.
 */
@Module({
  imports: [AccountsModule],
  providers: [MailboxRepository],
  exports: [MailboxRepository],
})
export class MailboxesModule {}
