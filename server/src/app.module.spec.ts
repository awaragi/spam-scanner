import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { Test } from '@nestjs/testing';

const ORIGINAL_ENV = { ...process.env };

/**
 * `AppModule` transitively imports `AppConfigModule`, which calls
 * `ConfigModule.forRoot()` (reading `process.env`) the moment
 * `config/config.module.ts` is imported/evaluated - not lazily at test time.
 * Each test needs a fresh import taken after the fixture env is set, via
 * `vi.resetModules()` (same pattern as `config/config.module.spec.ts`).
 */
async function loadAppModule() {
  vi.resetModules();
  const { AppModule } = await import('./app.module.js');
  return AppModule;
}

/**
 * The one test task 7.2 adds beyond wiring itself (see its tasks.md entry):
 * confirms the whole DI graph - every module created/wired in this task -
 * actually resolves, without booting a real IMAP/rspamd/AI connection.
 * `RunnerRegistry.onApplicationBootstrap` never runs here, since
 * `Test.createTestingModule(...).compile()` builds the container but does
 * not trigger Nest's application lifecycle hooks (only `NestFactory`/
 * `app.init()` do that) - so this is a pure "does everything wire up"
 * check, not an end-to-end run.
 */
describe('AppModule', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  // Compiling the whole DI graph (now including AccountsModule's
  // imapflow-backed providers) can run well past vitest's 5s default
  // under the heavier concurrent load `turbo run lint test` puts on CI
  // runners/dev machines - this is just the one slow, whole-graph test,
  // not a real hang (it resolves in well under a second standalone).
  test('compiles and resolves RunnerRegistry from a fixture env with zero mailbox accounts', async () => {
    Object.assign(process.env, {
      API_ADMIN_PASSWORD: 'admin-secret',
      API_JWT_SECRET: 'jwt-secret',
    });

    const AppModule = await loadAppModule();
    const { RunnerRegistry } = await import('./runtime/runner-registry.js');

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    try {
      expect(moduleRef.get(RunnerRegistry)).toBeInstanceOf(RunnerRegistry);
    } finally {
      await moduleRef.close();
    }
  }, 20000);
});
