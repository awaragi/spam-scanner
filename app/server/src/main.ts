import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { ServerConfig } from './config/app-config.js';

/**
 * Bootstraps the whole app (task 7.2).
 *
 * `bufferLogs: true` holds every log emitted before nestjs-pino's
 * `LoggerModule` resolves (config validation runs first, during
 * `AppConfigModule`'s own construction), so nothing is lost; `app.useLogger`
 * then switches Nest's own internal logging over to that same pino instance
 * (nestjs-pino's documented pattern for `bufferLogs`).
 *
 * `enableShutdownHooks()` is what makes `RunnerRegistry`'s
 * `OnApplicationShutdown` actually fire on `SIGTERM`/`SIGINT` - every
 * mailbox runner's only way to stop cleanly (design.md D9); without it, Nest
 * never calls shutdown lifecycle hooks on process signals. `useProcessExit: true`
 * is required to actually exit with code 0 afterwards: Nest's default
 * (re-sending the original signal to itself once hooks finish) exits with
 * 128+signal instead, and skips the `'exit'` event pino's async transports
 * (`LOG_FORMAT=pretty`'s `pino-pretty`) need to flush before the process
 * terminates.
 *
 * The port comes from the injected `ServerConfig` via `app.get(...)`, since
 * `main.ts` runs before any request-scoped injection context exists.
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks(undefined, { useProcessExit: true });

  const { port } = app.get(ServerConfig);
  await app.listen(port);
}
await bootstrap();
