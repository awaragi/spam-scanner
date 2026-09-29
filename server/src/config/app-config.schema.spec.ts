import { describe, test, expect } from 'vitest';
import { AppConfigSchema, type AppConfig } from './app-config.schema.js';

/**
 * The minimal environment that satisfies every field with no safe default
 * (the mailbox connection info - see design.md D5; validation runs once at
 * Nest bootstrap). Every other key is left unset so its own default applies.
 */
function requiredOnlyEnv(): Record<string, string> {
  return {
    MAILBOX_1_ID: 'owner@example.com',
    MAILBOX_1_IMAP_HOST: 'imap.example.com',
    MAILBOX_1_IMAP_USER: 'owner@example.com',
    MAILBOX_1_IMAP_PASSWORD: 'secret',
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
    expect(AppConfigSchema.safeParse(requiredOnlyEnv()).success).toBe(true);
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

    test('rejects a non-numeric MAILBOX_1_IMAP_PORT rather than silently producing NaN', () => {
      const result = AppConfigSchema.safeParse({
        ...requiredOnlyEnv(),
        MAILBOX_1_IMAP_PORT: '5m',
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(
        result.error.issues.some(
          (issue) => issue.path.join('.') === 'MAILBOXES.MAILBOX_1_IMAP_PORT',
        ),
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

    test('the mailbox IMAP_TLS is false only when explicitly set to "false"', () => {
      const result = AppConfigSchema.safeParse({
        ...requiredOnlyEnv(),
        MAILBOX_1_IMAP_TLS: 'false',
        // Required alongside MAILBOX_1_IMAP_TLS=false since 2.5 - see the
        // 'cross-field validation' describe block below; irrelevant to what
        // this test asserts about boolField parsing.
        MAILBOX_1_IMAP_ALLOW_INSECURE: 'true',
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(asConfig(result.data).MAILBOXES[0].imapTls).toBe(false);
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

    test.each([
      'MAILBOX_1_ID',
      'MAILBOX_1_IMAP_HOST',
      'MAILBOX_1_IMAP_USER',
      'MAILBOX_1_IMAP_PASSWORD',
    ])('rejects a missing required field %s', (key) => {
      const env = requiredOnlyEnv();
      delete (env as Record<string, string | undefined>)[key];

      const result = AppConfigSchema.safeParse(env);

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(
        result.error.issues.some(
          (issue) => issue.path.join('.') === `MAILBOXES.${key}`,
        ),
      ).toBe(true);
    });

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

    test('rejects a MAILBOX_1_ID that is not shaped like an email address', () => {
      const result = AppConfigSchema.safeParse({
        ...requiredOnlyEnv(),
        MAILBOX_1_ID: 'not-an-email',
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(
        result.error.issues.some(
          (issue) => issue.path.join('.') === 'MAILBOXES.MAILBOX_1_ID',
        ),
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

    const paths = result.error.issues.map((issue) => issue.path.join('.'));
    expect(paths).toContain('SCAN_INTERVAL');
    expect(paths).toContain('RSPAMD_TIMEOUT_MS');
  });

  test('reports a missing required field and an out-of-range field together', () => {
    const env = requiredOnlyEnv();
    delete (env as Record<string, string | undefined>).MAILBOX_1_IMAP_HOST;

    const result = AppConfigSchema.safeParse({
      ...env,
      AI_MAX_RETRIES: 'nope',
    });

    expect(result.success).toBe(false);
    if (result.success) return;

    const paths = result.error.issues.map((issue) => issue.path.join('.'));
    expect(paths).toContain('MAILBOXES.MAILBOX_1_IMAP_HOST');
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

    test('rejects MAILBOX_1_IMAP_TLS=false with no MAILBOX_1_IMAP_ALLOW_INSECURE opt-in', () => {
      const result = AppConfigSchema.safeParse({
        ...requiredOnlyEnv(),
        MAILBOX_1_IMAP_TLS: 'false',
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(
        result.error.issues.some(
          (issue) =>
            issue.path.join('.') === 'MAILBOXES.MAILBOX_1_IMAP_ALLOW_INSECURE',
        ),
      ).toBe(true);
    });

    test('accepts MAILBOX_1_IMAP_TLS=false when MAILBOX_1_IMAP_ALLOW_INSECURE=true', () => {
      const result = AppConfigSchema.safeParse({
        ...requiredOnlyEnv(),
        MAILBOX_1_IMAP_TLS: 'false',
        MAILBOX_1_IMAP_ALLOW_INSECURE: 'true',
      });

      expect(result.success).toBe(true);
    });

    test('does not require MAILBOX_1_IMAP_ALLOW_INSECURE when MAILBOX_1_IMAP_TLS is at its default (true)', () => {
      const result = AppConfigSchema.safeParse(requiredOnlyEnv());

      expect(result.success).toBe(true);
    });

    test('reports AI_MODEL missing, the mailbox ALLOW_INSECURE missing, and an unrelated bad field together', () => {
      // SCAN_INTERVAL=0 fails its own `.refine()` (a "custom" zod issue), not
      // the underlying number type check - zod only runs `.superRefine()` on
      // an object once every field it declares has passed its own type-level
      // parsing, so a plain type failure (e.g. a non-numeric string) here
      // would suppress the superRefine issues below entirely.
      const result = AppConfigSchema.safeParse({
        ...requiredOnlyEnv(),
        AI_ENABLED: 'true',
        MAILBOX_1_IMAP_TLS: 'false',
        SCAN_INTERVAL: '0',
      });

      expect(result.success).toBe(false);
      if (result.success) return;

      const paths = result.error.issues.map((issue) => issue.path.join('.'));
      expect(paths).toContain('AI_MODEL');
      expect(paths).toContain('AI_API_KEY');
      expect(paths).toContain('MAILBOXES.MAILBOX_1_IMAP_ALLOW_INSECURE');
      expect(paths).toContain('SCAN_INTERVAL');
    });
  });

  describe('mailbox slots - dynamically discovered, no fixed limit', () => {
    test('a second mailbox is optional - one mailbox alone still parses', () => {
      const result = AppConfigSchema.safeParse(requiredOnlyEnv());

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(asConfig(result.data).MAILBOXES).toHaveLength(1);
    });

    test('accepts a fully-configured second mailbox', () => {
      const result = AppConfigSchema.safeParse({
        ...requiredOnlyEnv(),
        MAILBOX_2_ID: 'second@example.com',
        MAILBOX_2_IMAP_HOST: 'imap.example.com',
        MAILBOX_2_IMAP_USER: 'second@example.com',
        MAILBOX_2_IMAP_PASSWORD: 'secret-2',
      });

      expect(result.success).toBe(true);
      if (!result.success) return;
      const mailboxes = asConfig(result.data).MAILBOXES;
      expect(mailboxes).toHaveLength(2);
      expect(mailboxes[1].id).toBe('second@example.com');
    });

    test('rejects an env with no MAILBOX_ keys at all', () => {
      const result = AppConfigSchema.safeParse({
        API_ADMIN_PASSWORD: 'admin-secret',
        API_JWT_SECRET: 'jwt-secret',
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(
        result.error.issues.some(
          (issue) => issue.path.join('.') === 'MAILBOXES.MAILBOX_1_ID',
        ),
      ).toBe(true);
    });

    test('there is no fixed limit on how many mailboxes are accepted', () => {
      const env = requiredOnlyEnv();
      for (let index = 2; index <= 9; index++) {
        env[`MAILBOX_${index}_ID`] = `user${index}@example.com`;
        env[`MAILBOX_${index}_IMAP_HOST`] = 'imap.example.com';
        env[`MAILBOX_${index}_IMAP_USER`] = `user${index}@example.com`;
        env[`MAILBOX_${index}_IMAP_PASSWORD`] = `secret-${index}`;
      }

      const result = AppConfigSchema.safeParse(env);

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(asConfig(result.data).MAILBOXES).toHaveLength(9);
      expect(asConfig(result.data).MAILBOXES[8].id).toBe('user9@example.com');
    });

    test('rejects a partially-configured second mailbox, pointing at the specific missing fields', () => {
      const result = AppConfigSchema.safeParse({
        ...requiredOnlyEnv(),
        MAILBOX_2_ID: 'second@example.com',
        MAILBOX_2_IMAP_HOST: 'imap.example.com',
        // MAILBOX_2_IMAP_USER/PASSWORD left unset.
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      const paths = result.error.issues.map((issue) => issue.path.join('.'));
      expect(paths).toContain('MAILBOXES.MAILBOX_2_IMAP_USER');
      expect(paths).toContain('MAILBOXES.MAILBOX_2_IMAP_PASSWORD');
    });

    test('rejects a non-email MAILBOX_2_ID', () => {
      const result = AppConfigSchema.safeParse({
        ...requiredOnlyEnv(),
        MAILBOX_2_ID: 'not-an-email',
        MAILBOX_2_IMAP_HOST: 'imap.example.com',
        MAILBOX_2_IMAP_USER: 'second@example.com',
        MAILBOX_2_IMAP_PASSWORD: 'secret-2',
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(
        result.error.issues.some(
          (issue) => issue.path.join('.') === 'MAILBOXES.MAILBOX_2_ID',
        ),
      ).toBe(true);
    });

    test('rejects a duplicate mailbox id across slots', () => {
      const result = AppConfigSchema.safeParse({
        ...requiredOnlyEnv(),
        MAILBOX_2_ID: 'owner@example.com',
        MAILBOX_2_IMAP_HOST: 'imap.example.com',
        MAILBOX_2_IMAP_USER: 'owner@example.com',
        MAILBOX_2_IMAP_PASSWORD: 'secret-2',
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(
        result.error.issues.some(
          (issue) => issue.path.join('.') === 'MAILBOXES.MAILBOX_2_ID',
        ),
      ).toBe(true);
    });

    test('rejects a configured MAILBOX_3 when MAILBOX_2 is left unset (a gap)', () => {
      const result = AppConfigSchema.safeParse({
        ...requiredOnlyEnv(),
        MAILBOX_3_ID: 'third@example.com',
        MAILBOX_3_IMAP_HOST: 'imap.example.com',
        MAILBOX_3_IMAP_USER: 'third@example.com',
        MAILBOX_3_IMAP_PASSWORD: 'secret-3',
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(
        result.error.issues.some(
          (issue) => issue.path.join('.') === 'MAILBOXES.MAILBOX_3_ID',
        ),
      ).toBe(true);
    });

    test('requires MAILBOX_2_IMAP_ALLOW_INSECURE alongside MAILBOX_2_IMAP_TLS=false, independently of mailbox 1', () => {
      const result = AppConfigSchema.safeParse({
        ...requiredOnlyEnv(),
        MAILBOX_2_ID: 'second@example.com',
        MAILBOX_2_IMAP_HOST: 'imap.example.com',
        MAILBOX_2_IMAP_USER: 'second@example.com',
        MAILBOX_2_IMAP_PASSWORD: 'secret-2',
        MAILBOX_2_IMAP_TLS: 'false',
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(
        result.error.issues.some(
          (issue) =>
            issue.path.join('.') === 'MAILBOXES.MAILBOX_2_IMAP_ALLOW_INSECURE',
        ),
      ).toBe(true);
    });
  });
});
