import { Module } from '@nestjs/common';
import { MailboxRepository } from './mailbox.repository.js';

/**
 * Provides `MailboxRepository`, the env-backed mailbox registry (see the
 * `server/mailbox-registry` spec - exactly one mailbox, built from
 * `MailboxConnectionConfig`). That config section comes from the global
 * `AppConfigModule` (`config/config.module.ts`) without an explicit import
 * here.
 */
@Module({
  providers: [MailboxRepository],
  exports: [MailboxRepository],
})
export class MailboxesModule {}
