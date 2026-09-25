import { Module } from '@nestjs/common';
import { MailboxesModule } from '../infrastructure/mailboxes/mailboxes.module.js';
import { FoldersModule } from '../application/folders/folders.module.js';
import { TrainingModule } from '../application/training/training.module.js';
import { ScanningModule } from '../application/scanning/scanning.module.js';
import { AiModule } from '../infrastructure/ai/ai.module.js';
import { RunnerRegistry } from './runner-registry.js';

/**
 * Provides `RunnerRegistry`, the `MailboxRunner`-per-mailbox orchestrator
 * from design.md D1 that replaces `2-nest-server-foundation`'s temporary run
 * loop - the only thing driving behavior at runtime for this change (`api/`
 * stays empty until `5-server-api-auth`). `ScanConfig` comes from the global
 * `AppConfigModule`;
 * `PinoLogger` comes from nestjs-pino's own global `LoggerModule` (see
 * `logging/logging.module.ts`) - neither needs an explicit import here.
 * `AiModule` is imported explicitly (it is not `@Global()`) so
 * `RunnerRegistry` can inject the shared `AiFailureTracker` for its status
 * output (design.md D10).
 */
@Module({
  imports: [
    MailboxesModule,
    FoldersModule,
    TrainingModule,
    ScanningModule,
    AiModule,
  ],
  providers: [RunnerRegistry],
  exports: [RunnerRegistry],
})
export class RuntimeModule {}
