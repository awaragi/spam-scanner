import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { AppConfigModule } from './config/config.module.js';
import { API_PREFIX } from './config/app-config.schema.js';
import { AppLoggingModule } from './logging/logging.module.js';
import { RspamdModule } from './infrastructure/rspamd/rspamd.module.js';
import { AiModule } from './infrastructure/ai/ai.module.js';
import { MailboxesModule } from './infrastructure/mailboxes/mailboxes.module.js';
import { ScanningModule } from './application/scanning/scanning.module.js';
import { TrainingModule } from './application/training/training.module.js';
import { FoldersModule } from './application/folders/folders.module.js';
import { RuntimeModule } from './runtime/runtime.module.js';
import { ApiModule } from './api/api.module.js';

/**
 * The whole app, wired per design.md D1/D3/D9 (task 7.2 - the final
 * integration step of `2-nest-server-foundation`) and `5-server-api-auth`
 * design.md D9 (`ApiModule`, imported last).
 *
 * Import order follows the dependency direction (D3): `AppConfigModule`
 * (`@Global`, validates the environment once at bootstrap) and
 * `AppLoggingModule` (nestjs-pino, itself `@Global`) first, then the
 * infrastructure adapters, then the application use-cases that consume them,
 * then `RuntimeModule`, and finally `ApiModule` - the HTTP surface sitting
 * at the top of the dependency direction, consuming everything below it.
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
    // Serves the built Angular app at `/` (bootstrap-level, like
    // AppLoggingModule - not an `api/` concern). `exclude` is a `RegExp`,
    // not a string glob, so it never depends on `path-to-regexp`'s
    // Express-5 wildcard syntax (`serve-frontend-from-server` design.md
    // D1/D2/D3/D5). `rootPath` is empty at dev time (`npm run start:dev`);
    // only the Docker build (D6) populates `server/public`.
    ServeStaticModule.forRoot({
      rootPath: join(import.meta.dirname, '..', 'public'),
      exclude: new RegExp(`^/${API_PREFIX}(/|$)`),
    }),
    RspamdModule,
    AiModule,
    MailboxesModule,
    ScanningModule,
    TrainingModule,
    FoldersModule,
    RuntimeModule,
    ApiModule,
  ],
})
export class AppModule {}
