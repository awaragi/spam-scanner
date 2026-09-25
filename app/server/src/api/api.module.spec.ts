import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PinoLogger } from 'nestjs-pino';

const ORIGINAL_ENV = { ...process.env };

/**
 * `MailboxAdminService` (behind `MailboxAdminModule`, imported by
 * `ApiModule`) injects `PinoLogger`. In the real app that comes from
 * nestjs-pino's own `LoggerModule` (wrapped by `logging/logging.module.ts`,
 * itself `@Global()` upstream), but this spec can't import
 * `logging/logging.module.js` directly - `.dependency-cruiser.cjs`'s
 * `api-layer-direction` rule forbids anything under `src/api` from
 * depending on `src/logging` (bootstrap wiring, not one of the layers `api/`
 * may depend on). A local `@Global()` stub module providing a bare
 * `PinoLogger` instance (constructed the same no-arg way nestjs-pino's own
 * `LoggerModule` does) satisfies the dependency without that import -
 * `@Global()` modules apply to the whole compiled testing module regardless
 * of which import in the `imports` array pulled them in.
 */
@Global()
@Module({
  providers: [{ provide: PinoLogger, useValue: new PinoLogger({}) }],
  exports: [PinoLogger],
})
class StubLoggerModule {}

/**
 * `ApiModule` transitively imports `AuthModule`, whose `JwtModule.
 * registerAsync` injects `ApiAuthConfig` - which comes from the global
 * `AppConfigModule`. So, like `auth/auth.module.spec.ts` and
 * `app.module.spec.ts`, this test needs `AppConfigModule` in the testing
 * module's imports and a fixture env set before either module is imported
 * (`ConfigModule.forRoot()` reads `process.env` at import time).
 *
 * This is the resolution check design.md D9/task 11.1 calls for: confirms
 * every controller `ApiModule` declares (plus `AuthController`, which is
 * declared by the imported `AuthModule` itself), and `HealthService`/
 * `AuthService` (and, by extension, the guards those controllers depend on
 * via `@UseGuards(...)`), resolve from the DI graph - without booting a
 * real IMAP/rspamd/AI connection or Nest's application lifecycle.
 */
async function loadModules() {
  vi.resetModules();
  const [{ ApiModule }, { AppConfigModule }] = await Promise.all([
    import('./api.module.js'),
    import('../config/config.module.js'),
  ]);
  return { ApiModule, AppConfigModule };
}

describe('ApiModule', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  test('compiles and resolves every controller plus HealthService/AuthService from a fixture env', async () => {
    Object.assign(process.env, {
      MAILBOX_ID: 'owner@example.com',
      MAILBOX_IMAP_HOST: 'imap.example.com',
      MAILBOX_IMAP_USER: 'owner@example.com',
      MAILBOX_IMAP_PASSWORD: 'secret',
      MAILBOX_STATE_FOLDER: 'INBOX.scanner.state',
      API_ADMIN_PASSWORD: 'admin-secret',
      API_JWT_SECRET: 'jwt-secret',
    });

    const { ApiModule, AppConfigModule } = await loadModules();
    const [
      { AuthController },
      { AdminController },
      { MailboxController },
      { HealthController },
      { HealthService },
      { AuthService },
    ] = await Promise.all([
      import('./auth/auth.controller.js'),
      import('./admin/admin.controller.js'),
      import('./mailbox/mailbox.controller.js'),
      import('./health/health.controller.js'),
      import('./health/health.service.js'),
      import('./auth/auth.service.js'),
    ]);

    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, StubLoggerModule, ApiModule],
    }).compile();

    try {
      expect(moduleRef.get(AuthController)).toBeInstanceOf(AuthController);
      expect(moduleRef.get(AdminController)).toBeInstanceOf(AdminController);
      expect(moduleRef.get(MailboxController)).toBeInstanceOf(MailboxController);
      expect(moduleRef.get(HealthController)).toBeInstanceOf(HealthController);
      expect(moduleRef.get(HealthService)).toBeInstanceOf(HealthService);
      expect(moduleRef.get(AuthService)).toBeInstanceOf(AuthService);
    } finally {
      await moduleRef.close();
    }
  });
});
