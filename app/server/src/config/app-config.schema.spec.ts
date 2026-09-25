import { describe, test, expect } from 'vitest';
import { AppConfigSchema, configGroups } from './app-config.schema.js';

/**
 * The minimal environment that satisfies every field with no safe default
 * (the mailbox connection info - see design.md D5, which drops
 * terminal's `assertRequiredConfig` split now that validation runs once at
 * Nest bootstrap). Every other key is left unset so its own default applies.
 */
function requiredOnlyEnv(): Record<string, string> {
  return {
    MAILBOX_ID: 'owner@example.com',
    MAILBOX_IMAP_HOST: 'imap.example.com',
    MAILBOX_IMAP_USER: 'owner@example.com',
    MAILBOX_IMAP_PASSWORD: 'secret',
  };
}

describe('AppConfigSchema', () => {
  test('resolves every group default from an env that only sets the required fields', () => {
    const result = AppConfigSchema.safeParse(requiredOnlyEnv());

    expect(result.success).toBe(true);
    if (!result.success) return;

    // Rspamd
    expect(result.data.RSPAMD_URL).toBe('http://localhost:11334');
    expect(result.data.RSPAMD_PASSWORD).toBe('');
    expect(result.data.RSPAMD_TIMEOUT_MS).toBe(30000);
    expect(result.data.RSPAMD_ENVELOPE_TRUSTED_HOPS).toBe(0);

    // AI
    expect(result.data.AI_ENABLED).toBe(false);
    expect(result.data.AI_BASE_URL).toBe('https://api.openai.com/v1');
    expect(result.data.AI_API_KEY).toBe('');
    expect(result.data.AI_MODEL).toBe('');
    expect(result.data.AI_TIMEOUT_MS).toBe(15000);
    expect(result.data.AI_MAX_RETRIES).toBe(1);
    expect(result.data.AI_CONCURRENCY).toBe(5);
    expect(result.data.AI_MAX_INPUT_TOKENS).toBe(6000);
    expect(result.data.AI_MAX_OUTPUT_TOKENS).toBe(2000);
    expect(result.data.AI_FAILURE_ALERT_THRESHOLD).toBe(3);

    // Scan/train
    expect(result.data.SCAN_INTERVAL).toBe(300);
    expect(result.data.BATCH_SCAN_SIZE).toBe(200);
    expect(result.data.BATCH_PROCESS_SIZE).toBe(10);
    expect(result.data.MAX_RETRIES).toBe(5);

    // Logging
    expect(result.data.LOG_LEVEL).toBe('info');
    expect(result.data.LOG_FORMAT).toBe('json');
    expect(result.data.LOG_FILTER_INCLUDES).toBe('');
    expect(result.data.LOG_FILTER_EXCLUDES).toBe('imapflow');

    // HTTP server
    expect(result.data.PORT).toBe(3000);

    // Mailbox connection
    expect(result.data.MAILBOX_ID).toBe('owner@example.com');
    expect(result.data.MAILBOX_IMAP_HOST).toBe('imap.example.com');
    expect(result.data.MAILBOX_IMAP_PORT).toBe(993);
    expect(result.data.MAILBOX_IMAP_USER).toBe('owner@example.com');
    expect(result.data.MAILBOX_IMAP_PASSWORD).toBe('secret');
    expect(result.data.MAILBOX_IMAP_TLS).toBe(true);
    expect(result.data.MAILBOX_IMAP_ALLOW_INSECURE).toBe(false);
    expect(result.data.MAILBOX_STATE_FOLDER).toBe('INBOX.scanner.state');
  });

  test('every declared group is included in configGroups, in schema order', () => {
    const titles = configGroups.map(group => group.title);
    expect(titles).toEqual([
      'Rspamd Configuration',
      'AI Classification Configuration (optional safety-net escalation layer on top of rspamd)',
      'Scan/Train Configuration',
      'Logging Configuration',
      'HTTP Server Configuration',
      "The Server's Mailbox Connection",
    ]);
  });

  describe('per-key validation', () => {
    test.each([
      'RSPAMD_TIMEOUT_MS',
      'RSPAMD_ENVELOPE_TRUSTED_HOPS',
      'AI_TIMEOUT_MS',
      'AI_MAX_RETRIES',
      'AI_CONCURRENCY',
      'AI_MAX_INPUT_TOKENS',
      'AI_MAX_OUTPUT_TOKENS',
      'AI_FAILURE_ALERT_THRESHOLD',
      'BATCH_SCAN_SIZE',
      'BATCH_PROCESS_SIZE',
      'MAX_RETRIES',
      'PORT',
      'MAILBOX_IMAP_PORT',
    ])('rejects a non-numeric %s rather than silently producing NaN', key => {
      const result = AppConfigSchema.safeParse({
        ...requiredOnlyEnv(),
        [key]: '5m',
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues.some(issue => issue.path.join('.') === key)).toBe(
        true
      );
    });

    test('rejects SCAN_INTERVAL=0 now that IDLE mode is gone', () => {
      const result = AppConfigSchema.safeParse({
        ...requiredOnlyEnv(),
        SCAN_INTERVAL: '0',
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(
        result.error.issues.some(issue => issue.path.join('.') === 'SCAN_INTERVAL')
      ).toBe(true);
    });

    test('rejects a negative SCAN_INTERVAL now that single-run mode is gone', () => {
      const result = AppConfigSchema.safeParse({
        ...requiredOnlyEnv(),
        SCAN_INTERVAL: '-1',
      });

      expect(result.success).toBe(false);
    });

    test('accepts a positive SCAN_INTERVAL', () => {
      const result = AppConfigSchema.safeParse({
        ...requiredOnlyEnv(),
        SCAN_INTERVAL: '60',
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.SCAN_INTERVAL).toBe(60);
    });

    test('MAILBOX_IMAP_TLS is false only when explicitly set to "false"', () => {
      const result = AppConfigSchema.safeParse({
        ...requiredOnlyEnv(),
        MAILBOX_IMAP_TLS: 'false',
        // Required alongside MAILBOX_IMAP_TLS=false since 2.5 - see the
        // 'cross-field validation' describe block below; irrelevant to what
        // this test asserts about boolField parsing.
        MAILBOX_IMAP_ALLOW_INSECURE: 'true',
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.MAILBOX_IMAP_TLS).toBe(false);
    });

    test('AI_ENABLED is true only when explicitly set to "true"', () => {
      const result = AppConfigSchema.safeParse({
        ...requiredOnlyEnv(),
        AI_ENABLED: 'true',
        // Required alongside AI_ENABLED=true since 2.5 - see the
        // 'cross-field validation' describe block below; irrelevant to what
        // this test asserts about boolField parsing.
        AI_MODEL: 'gpt-4o-mini',
        AI_API_KEY: 'sk-test',
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.AI_ENABLED).toBe(true);
    });

    test.each(['MAILBOX_ID', 'MAILBOX_IMAP_HOST', 'MAILBOX_IMAP_USER', 'MAILBOX_IMAP_PASSWORD'])(
      'rejects a missing required field %s',
      key => {
        const env = requiredOnlyEnv();
        delete (env as Record<string, string | undefined>)[key];

        const result = AppConfigSchema.safeParse(env);

        expect(result.success).toBe(false);
        if (result.success) return;
        expect(
          result.error.issues.some(issue => issue.path.join('.') === key)
        ).toBe(true);
      }
    );

    test('rejects a MAILBOX_ID that is not shaped like an email address', () => {
      const result = AppConfigSchema.safeParse({
        ...requiredOnlyEnv(),
        MAILBOX_ID: 'not-an-email',
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(
        result.error.issues.some(issue => issue.path.join('.') === 'MAILBOX_ID')
      ).toBe(true);
    });
  });

  test('reports two simultaneous, independent validation failures together, not just the first', () => {
    const result = AppConfigSchema.safeParse({
      ...requiredOnlyEnv(),
      SCAN_INTERVAL: 'not-a-number',
      RSPAMD_TIMEOUT_MS: 'also-not-a-number',
    });

    expect(result.success).toBe(false);
    if (result.success) return;

    const paths = result.error.issues.map(issue => issue.path.join('.'));
    expect(paths).toContain('SCAN_INTERVAL');
    expect(paths).toContain('RSPAMD_TIMEOUT_MS');
  });

  test('reports a missing required field and an out-of-range field together', () => {
    const env = requiredOnlyEnv();
    delete (env as Record<string, string | undefined>).MAILBOX_IMAP_HOST;

    const result = AppConfigSchema.safeParse({
      ...env,
      AI_MAX_RETRIES: 'nope',
    });

    expect(result.success).toBe(false);
    if (result.success) return;

    const paths = result.error.issues.map(issue => issue.path.join('.'));
    expect(paths).toContain('MAILBOX_IMAP_HOST');
    expect(paths).toContain('AI_MAX_RETRIES');
  });

  describe('cross-field validation', () => {
    test('rejects AI_ENABLED=true with no AI_MODEL', () => {
      const result = AppConfigSchema.safeParse({
        ...requiredOnlyEnv(),
        AI_ENABLED: 'true',
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(
        result.error.issues.some(issue => issue.path.join('.') === 'AI_MODEL')
      ).toBe(true);
    });

    test('does not require AI_MODEL when AI_ENABLED is false', () => {
      const result = AppConfigSchema.safeParse({
        ...requiredOnlyEnv(),
        AI_MODEL: '',
      });

      expect(result.success).toBe(true);
    });

    test('rejects AI_ENABLED=true with no AI_API_KEY against the default OpenAI base URL', () => {
      const result = AppConfigSchema.safeParse({
        ...requiredOnlyEnv(),
        AI_ENABLED: 'true',
        AI_MODEL: 'gpt-4o-mini',
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(
        result.error.issues.some(issue => issue.path.join('.') === 'AI_API_KEY')
      ).toBe(true);
    });

    test('does not require AI_API_KEY when AI_ENABLED is false, even with AI_MODEL/AI_API_KEY unset', () => {
      const result = AppConfigSchema.safeParse(requiredOnlyEnv());

      expect(result.success).toBe(true);
    });

    test('does not require AI_API_KEY when AI_BASE_URL points at a non-default endpoint', () => {
      const result = AppConfigSchema.safeParse({
        ...requiredOnlyEnv(),
        AI_ENABLED: 'true',
        AI_MODEL: 'llama3',
        AI_BASE_URL: 'http://localhost:11434/v1',
      });

      expect(result.success).toBe(true);
    });

    test('rejects MAILBOX_IMAP_TLS=false with no MAILBOX_IMAP_ALLOW_INSECURE opt-in', () => {
      const result = AppConfigSchema.safeParse({
        ...requiredOnlyEnv(),
        MAILBOX_IMAP_TLS: 'false',
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(
        result.error.issues.some(
          issue => issue.path.join('.') === 'MAILBOX_IMAP_ALLOW_INSECURE'
        )
      ).toBe(true);
    });

    test('accepts MAILBOX_IMAP_TLS=false when MAILBOX_IMAP_ALLOW_INSECURE=true', () => {
      const result = AppConfigSchema.safeParse({
        ...requiredOnlyEnv(),
        MAILBOX_IMAP_TLS: 'false',
        MAILBOX_IMAP_ALLOW_INSECURE: 'true',
      });

      expect(result.success).toBe(true);
    });

    test('does not require MAILBOX_IMAP_ALLOW_INSECURE when MAILBOX_IMAP_TLS is at its default (true)', () => {
      const result = AppConfigSchema.safeParse(requiredOnlyEnv());

      expect(result.success).toBe(true);
    });

    test('reports AI_MODEL missing, MAILBOX_IMAP_ALLOW_INSECURE missing, and an unrelated bad field together', () => {
      // SCAN_INTERVAL=0 fails its own `.refine()` (a "custom" zod issue), not
      // the underlying number type check - zod only runs `.superRefine()` on
      // an object once every field it declares has passed its own type-level
      // parsing, so a plain type failure (e.g. a non-numeric string) here
      // would suppress the superRefine issues below entirely.
      const result = AppConfigSchema.safeParse({
        ...requiredOnlyEnv(),
        AI_ENABLED: 'true',
        MAILBOX_IMAP_TLS: 'false',
        SCAN_INTERVAL: '0',
      });

      expect(result.success).toBe(false);
      if (result.success) return;

      const paths = result.error.issues.map(issue => issue.path.join('.'));
      expect(paths).toContain('AI_MODEL');
      expect(paths).toContain('AI_API_KEY');
      expect(paths).toContain('MAILBOX_IMAP_ALLOW_INSECURE');
      expect(paths).toContain('SCAN_INTERVAL');
    });
  });
});
