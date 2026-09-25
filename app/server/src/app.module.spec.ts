import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { Test } from '@nestjs/testing';

const ORIGINAL_ENV = { ...process.env };

/**
 * `AppModule` transitively imports `AppConfigModule`, which calls
 * `ConfigModule.forRoot()` (reading `process.env`) the moment
 * `config/config.module.ts` is imported/evaluated - not lazily at test time.
 * Each test needs a fresh import taken after the fixture env is set, via
 * `vi.resetModules()` (same pattern as `config/config.module.spec.ts` and
 * `terminal/test/unit/core/config.test.ts`).
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
 * `MailboxLoopService.onApplicationBootstrap` never runs here, since
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

  test('compiles and resolves MailboxLoopService from a fixture env', async () => {
    Object.assign(process.env, {
      MAILBOX_ID: 'owner@example.com',
      MAILBOX_IMAP_HOST: 'imap.example.com',
      MAILBOX_IMAP_USER: 'owner@example.com',
      MAILBOX_IMAP_PASSWORD: 'secret',
      MAILBOX_STATE_FOLDER: 'INBOX.scanner.state',
    });

    const AppModule = await loadAppModule();
    const { MailboxLoopService } = await import(
      './runtime/mailbox-loop.service.js'
    );

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    try {
      expect(moduleRef.get(MailboxLoopService)).toBeInstanceOf(
        MailboxLoopService
      );
    } finally {
      await moduleRef.close();
    }
  });
});
