import { Module } from '@nestjs/common';
import { MailboxesModule } from '../infrastructure/mailboxes/mailboxes.module.js';
import { FoldersModule } from '../application/folders/folders.module.js';
import { TrainingModule } from '../application/training/training.module.js';
import { ScanningModule } from '../application/scanning/scanning.module.js';
import { MailboxLoopService } from './mailbox-loop.service.js';

/**
 * Provides `MailboxLoopService`, the minimal run loop from design.md D9 -
 * the only thing driving behavior at runtime for this change (`api/` stays
 * empty until `5-server-api-auth`). `ScanConfig` comes from the global
 * `AppConfigModule`; `PinoLogger` comes from nestjs-pino's own global
 * `LoggerModule` (see `logging/logging.module.ts`) - neither needs an
 * explicit import here.
 */
@Module({
  imports: [MailboxesModule, FoldersModule, TrainingModule, ScanningModule],
  providers: [MailboxLoopService],
})
export class RuntimeModule {}
