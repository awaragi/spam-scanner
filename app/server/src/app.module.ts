import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module.js';
import { AppLoggingModule } from './logging/logging.module.js';
import { RspamdModule } from './infrastructure/rspamd/rspamd.module.js';
import { AiModule } from './infrastructure/ai/ai.module.js';
import { MailboxesModule } from './infrastructure/mailboxes/mailboxes.module.js';
import { ScanningModule } from './application/scanning/scanning.module.js';
import { TrainingModule } from './application/training/training.module.js';
import { FoldersModule } from './application/folders/folders.module.js';
import { RuntimeModule } from './runtime/runtime.module.js';

/**
 * The whole app, wired per design.md D1/D3/D9 (task 7.2 - the final
 * integration step of `2-nest-server-foundation`).
 *
 * Import order follows the dependency direction (D3): `AppConfigModule`
 * (`@Global`, validates the environment once at bootstrap) and
 * `AppLoggingModule` (nestjs-pino, itself `@Global`) first, then the
 * infrastructure adapters, then the application use-cases that consume them,
 * then `RuntimeModule` - the only thing driving behavior at runtime for this
 * change. `api/` stays empty until `5-server-api-auth`.
 *
 * Both `AppConfigModule` and nestjs-pino's `LoggerModule` (imported inside
 * `AppLoggingModule`) are `@Global()`, so importing each once here is enough
 * for every module below - and any future module - to inject their exports
 * without importing either module directly.
 */
@Module({
  imports: [
    AppConfigModule,
    AppLoggingModule,
    RspamdModule,
    AiModule,
    MailboxesModule,
    ScanningModule,
    TrainingModule,
    FoldersModule,
    RuntimeModule,
  ],
})
export class AppModule {}
