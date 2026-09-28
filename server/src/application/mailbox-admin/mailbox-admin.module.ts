import { Module } from '@nestjs/common';
import { MailboxesModule } from '../../infrastructure/mailboxes/mailboxes.module.js';
import { MailboxAdminService } from './mailbox-admin.service.js';

/**
 * Provides `MailboxAdminService`, the throwaway-IMAP-connection state/list
 * operations for one mailbox - `5-server-api-auth` design.md D7.
 * `MailboxRepository` comes from `MailboxesModule`; `PinoLogger` comes from
 * nestjs-pino's own global `LoggerModule` without an explicit import here.
 */
@Module({
  imports: [MailboxesModule],
  providers: [MailboxAdminService],
  exports: [MailboxAdminService],
})
export class MailboxAdminModule {}
