import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { Test } from '@nestjs/testing';

const ORIGINAL_ENV = { ...process.env };

/**
 * `AppConfigModule`'s `@Module({ imports: [ConfigModule.forRoot(...)] })`
 * calls `ConfigModule.forRoot()` (and therefore reads `process.env`) the
 * moment `config.module.ts` is imported/evaluated - not lazily at test time.
 * So each test needs a *fresh* import, taken after the fixture env is set,
 * via `vi.resetModules()` (same pattern as
 * `terminal/test/unit/core/config.test.ts`). `app-config.js` is imported
 * dynamically too, from the same reset cycle, so its `RspamdConfig` etc.
 * classes are the exact identities `config.module.ts` used as DI tokens -
 * a stale, separately-cached import would be a different class reference and
 * `moduleRef.get(...)` would fail to resolve it.
 */
async function loadConfigModule() {
  vi.resetModules();
  const [{ AppConfigModule }, appConfig] = await Promise.all([
    import('./config.module.js'),
    import('./app-config.js'),
  ]);
  return { AppConfigModule, ...appConfig };
}

describe('AppConfigModule', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  test('resolves every typed config section from a fixture env via Test.createTestingModule', async () => {
    Object.assign(process.env, {
      MAILBOX_ID: 'owner@example.com',
      MAILBOX_IMAP_HOST: 'imap.example.com',
      MAILBOX_IMAP_USER: 'owner@example.com',
      MAILBOX_IMAP_PASSWORD: 'secret',
      MAILBOX_STATE_FOLDER: 'INBOX.scanner.state',
      RSPAMD_URL: 'http://rspamd.internal:11334',
      RSPAMD_PASSWORD: 'rspamd-secret',
      RSPAMD_TIMEOUT_MS: '45000',
      AI_ENABLED: 'true',
      AI_MODEL: 'gpt-4o-mini',
      AI_API_KEY: 'sk-test',
      SCAN_INTERVAL: '120',
      LOG_LEVEL: 'debug',
      LOG_FORMAT: 'pretty',
      PORT: '4000',
    });

    const {
      AppConfigModule,
      RspamdConfig,
      AiConfig,
      ScanConfig,
      LoggingConfig,
      ServerConfig,
      MailboxConnectionConfig,
    } = await loadConfigModule();

    const moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule],
    }).compile();

    try {
      const rspamd = moduleRef.get(RspamdConfig);
      expect(rspamd.url).toBe('http://rspamd.internal:11334');
      expect(rspamd.password).toBe('rspamd-secret');
      expect(rspamd.timeoutMs).toBe(45000);
      expect(rspamd.envelopeTrustedHops).toBe(0);

      const ai = moduleRef.get(AiConfig);
      expect(ai.enabled).toBe(true);
      expect(ai.model).toBe('gpt-4o-mini');
      expect(ai.apiKey).toBe('sk-test');
      expect(ai.baseUrl).toBe('https://api.openai.com/v1');

      const scan = moduleRef.get(ScanConfig);
      expect(scan.scanIntervalSeconds).toBe(120);
      expect(scan.batchScanSize).toBe(200);
      expect(scan.batchProcessSize).toBe(10);
      expect(scan.maxRetries).toBe(5);

      const logging = moduleRef.get(LoggingConfig);
      expect(logging.level).toBe('debug');
      expect(logging.format).toBe('pretty');
      expect(logging.filterExcludes).toBe('imapflow');

      const server = moduleRef.get(ServerConfig);
      expect(server.port).toBe(4000);

      const mailbox = moduleRef.get(MailboxConnectionConfig);
      expect(mailbox.id).toBe('owner@example.com');
      expect(mailbox.imapHost).toBe('imap.example.com');
      expect(mailbox.imapUser).toBe('owner@example.com');
      expect(mailbox.imapPassword).toBe('secret');
      expect(mailbox.imapTls).toBe(true);
      expect(mailbox.imapAllowInsecure).toBe(false);
      expect(mailbox.stateFolder).toBe('INBOX.scanner.state');
    } finally {
      await moduleRef.close();
    }
  });

  test('fails to bootstrap (throws) when a required mailbox connection field is missing', async () => {
    delete process.env.MAILBOX_ID;
    delete process.env.MAILBOX_IMAP_HOST;
    delete process.env.MAILBOX_IMAP_USER;
    delete process.env.MAILBOX_IMAP_PASSWORD;

    const { AppConfigModule } = await loadConfigModule();

    await expect(
      Test.createTestingModule({ imports: [AppConfigModule] }).compile()
    ).rejects.toThrow(/MAILBOX_ID/);
  });
});
