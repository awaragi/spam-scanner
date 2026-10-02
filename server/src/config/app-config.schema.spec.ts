import { describe, test, expect } from 'vitest';
import { AppConfigSchema, type AppConfig } from './app-config.schema.js';

/**
 * The minimal environment that satisfies every field with no safe default.
 * Mailbox connection info is no longer an env concern at all (see
 * `persistent-mailbox-accounts` design.md D1) - only the HTTP API auth
 * secrets have no safe default. Every other key is left unset so its own
 * default applies.
 */
function requiredOnlyEnv(): Record<string, string> {
  return {
    API_ADMIN_PASSWORD: 'admin-secret',
    API_JWT_SECRET: 'jwt-secret',
  };
}

/**
 * `AppConfigSchema`'s own `.reduce`/`.merge`/`.extend` chain collapses zod's
 * field inference (see `AppConfig`'s doc comment in `app-config.schema.ts`),
 * so a successful parse's `.data` needs this same cast the schema's own
 * `superRefine` uses internally, rather than `AppConfig` being derivable via
 * `z.infer`.
 */
function asConfig(data: unknown): AppConfig {
  return data as AppConfig;
}

describe('AppConfigSchema', () => {
  test('an env that only sets the required fields parses, every other key falling back to its default', () => {
    const result = AppConfigSchema.safeParse(requiredOnlyEnv());
    expect(result.success).toBe(true);
  });

  test('a totally empty env is rejected (no MAILBOX_* keys are required any more, but the API auth secrets still are)', () => {
    const result = AppConfigSchema.safeParse({});

    expect(result.success).toBe(false);
    if (result.success) return;
    const paths = result.error.issues.map((issue) => issue.path.join('.'));
    expect(paths).toContain('API_ADMIN_PASSWORD');
    expect(paths).toContain('API_JWT_SECRET');
  });

  describe('SPAM_SCANNER_DATA', () => {
    test('defaults to an empty string, left for SpamScannerDataConfig to resolve to ~/.spam-scanner', () => {
      const result = AppConfigSchema.safeParse(requiredOnlyEnv());

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(asConfig(result.data).SPAM_SCANNER_DATA).toBe('');
    });

    test('an explicit absolute path parses through unchanged', () => {
      const result = AppConfigSchema.safeParse({
        ...requiredOnlyEnv(),
        SPAM_SCANNER_DATA: '/data/spam-scanner',
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(asConfig(result.data).SPAM_SCANNER_DATA).toBe(
        '/data/spam-scanner',
      );
    });
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
      'API_ADMIN_TOKEN_TTL',
      'API_MAILBOX_TOKEN_TTL',
    ])('rejects a non-numeric %s rather than silently producing NaN', (key) => {
      const result = AppConfigSchema.safeParse({
        ...requiredOnlyEnv(),
        [key]: '5m',
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(
        result.error.issues.some((issue) => issue.path.join('.') === key),
      ).toBe(true);
    });

    test('rejects SCAN_INTERVAL=0 now that IDLE mode is gone', () => {
      const result = AppConfigSchema.safeParse({
        ...requiredOnlyEnv(),
        SCAN_INTERVAL: '0',
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(
        result.error.issues.some(
          (issue) => issue.path.join('.') === 'SCAN_INTERVAL',
        ),
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
      expect(asConfig(result.data).SCAN_INTERVAL).toBe(60);
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
      expect(asConfig(result.data).AI_ENABLED).toBe(true);
    });

    test.each(['API_ADMIN_PASSWORD', 'API_JWT_SECRET'])(
      'rejects a missing required field %s',
      (key) => {
        const env = requiredOnlyEnv();
        delete (env as Record<string, string | undefined>)[key];

        const result = AppConfigSchema.safeParse(env);

        expect(result.success).toBe(false);
        if (result.success) return;
        expect(
          result.error.issues.some((issue) => issue.path.join('.') === key),
        ).toBe(true);
      },
    );

    test('parses a fixture env that sets all four HTTP API auth keys', () => {
      const result = AppConfigSchema.safeParse({
        ...requiredOnlyEnv(),
        API_ADMIN_PASSWORD: 'admin-secret',
        API_JWT_SECRET: 'jwt-secret',
        API_ADMIN_TOKEN_TTL: '7200',
        API_MAILBOX_TOKEN_TTL: '1800',
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      const data = asConfig(result.data);
      expect(data.API_ADMIN_PASSWORD).toBe('admin-secret');
      expect(data.API_JWT_SECRET).toBe('jwt-secret');
      expect(data.API_ADMIN_TOKEN_TTL).toBe(7200);
      expect(data.API_MAILBOX_TOKEN_TTL).toBe(1800);
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

    const paths = result.error.issues.map((issue) => issue.path.join('.'));
    expect(paths).toContain('SCAN_INTERVAL');
    expect(paths).toContain('RSPAMD_TIMEOUT_MS');
  });

  test('reports a missing required field and an out-of-range field together', () => {
    const env = requiredOnlyEnv();
    delete (env as Record<string, string | undefined>).API_ADMIN_PASSWORD;

    const result = AppConfigSchema.safeParse({
      ...env,
      AI_MAX_RETRIES: 'nope',
    });

    expect(result.success).toBe(false);
    if (result.success) return;

    const paths = result.error.issues.map((issue) => issue.path.join('.'));
    expect(paths).toContain('API_ADMIN_PASSWORD');
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
        result.error.issues.some(
          (issue) => issue.path.join('.') === 'AI_MODEL',
        ),
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
        result.error.issues.some(
          (issue) => issue.path.join('.') === 'AI_API_KEY',
        ),
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

    test('reports AI_MODEL missing, AI_API_KEY missing, and an unrelated bad field together', () => {
      // SCAN_INTERVAL=0 fails its own `.refine()` (a "custom" zod issue), not
      // the underlying number type check - zod only runs `.superRefine()` on
      // an object once every field it declares has passed its own type-level
      // parsing, so a plain type failure (e.g. a non-numeric string) here
      // would suppress the superRefine issues below entirely.
      const result = AppConfigSchema.safeParse({
        ...requiredOnlyEnv(),
        AI_ENABLED: 'true',
        SCAN_INTERVAL: '0',
      });

      expect(result.success).toBe(false);
      if (result.success) return;

      const paths = result.error.issues.map((issue) => issue.path.join('.'));
      expect(paths).toContain('AI_MODEL');
      expect(paths).toContain('AI_API_KEY');
      expect(paths).toContain('SCAN_INTERVAL');
    });
  });
});
