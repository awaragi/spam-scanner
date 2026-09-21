import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

describe('config', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  test('SPAM_PROCESSING_MODE defaults to "folder" when unset', async () => {
    delete process.env.SPAM_PROCESSING_MODE;
    process.env.AI_ENABLED = 'false';

    const { config } = await import('../../../src/lib/core/config.js');

    expect(config.SPAM_PROCESSING_MODE).toBe('folder');
  });

  test('AI_MODEL has no default: empty when AI is disabled and unset', async () => {
    delete process.env.AI_MODEL;
    process.env.AI_ENABLED = 'false';

    const { config } = await import('../../../src/lib/core/config.js');

    expect(config.AI_MODEL).toBe('');
  });

  test('throws at load time when AI_ENABLED=true and AI_MODEL is unset', async () => {
    delete process.env.AI_MODEL;
    process.env.AI_ENABLED = 'true';

    await expect(import('../../../src/lib/core/config.js')).rejects.toThrow(
      /AI_MODEL/
    );
  });

  test('does not throw when AI_ENABLED=true and AI_MODEL/AI_API_KEY are set', async () => {
    process.env.AI_MODEL = 'gpt-4o-mini';
    process.env.AI_ENABLED = 'true';
    process.env.AI_API_KEY = 'sk-test';

    const { config } = await import('../../../src/lib/core/config.js');

    expect(config.AI_MODEL).toBe('gpt-4o-mini');
  });

  test('SCAN_INITIAL_STATE defaults to "new" when unset', async () => {
    delete process.env.SCAN_INITIAL_STATE;
    process.env.AI_ENABLED = 'false';

    const { config } = await import('../../../src/lib/core/config.js');

    expect(config.SCAN_INITIAL_STATE).toBe('new');
  });

  test('SCAN_INITIAL_STATE accepts "all" (case-insensitive)', async () => {
    process.env.SCAN_INITIAL_STATE = 'ALL';
    process.env.AI_ENABLED = 'false';

    const { config } = await import('../../../src/lib/core/config.js');

    expect(config.SCAN_INITIAL_STATE).toBe('all');
  });

  test('throws at load time when SCAN_INITIAL_STATE is neither "new" nor "all"', async () => {
    process.env.SCAN_INITIAL_STATE = 'everything';
    process.env.AI_ENABLED = 'false';

    await expect(import('../../../src/lib/core/config.js')).rejects.toThrow(
      /SCAN_INITIAL_STATE/
    );
  });

  test('IMAP_TLS defaults to true when unset', async () => {
    delete process.env.IMAP_TLS;
    process.env.AI_ENABLED = 'false';

    const { config } = await import('../../../src/lib/core/config.js');

    expect(config.IMAP_TLS).toBe(true);
  });

  test('IMAP_TLS is false only when explicitly set to "false"', async () => {
    process.env.IMAP_TLS = 'false';
    process.env.IMAP_ALLOW_INSECURE = 'true';
    process.env.AI_ENABLED = 'false';

    const { config } = await import('../../../src/lib/core/config.js');

    expect(config.IMAP_TLS).toBe(false);
  });

  test('throws naming IMAP_ALLOW_INSECURE when IMAP_TLS=false and IMAP_ALLOW_INSECURE is unset', async () => {
    process.env.IMAP_TLS = 'false';
    delete process.env.IMAP_ALLOW_INSECURE;
    process.env.AI_ENABLED = 'false';

    await expect(import('../../../src/lib/core/config.js')).rejects.toThrow(
      /IMAP_ALLOW_INSECURE/
    );
  });

  test('does not throw when IMAP_TLS=false and IMAP_ALLOW_INSECURE=true', async () => {
    process.env.IMAP_TLS = 'false';
    process.env.IMAP_ALLOW_INSECURE = 'true';
    process.env.AI_ENABLED = 'false';

    const { config } = await import('../../../src/lib/core/config.js');

    expect(config.IMAP_ALLOW_INSECURE).toBe(true);
  });

  test('IMAP_ALLOW_INSECURE is not required when IMAP_TLS is at its default (true)', async () => {
    delete process.env.IMAP_TLS;
    delete process.env.IMAP_ALLOW_INSECURE;
    process.env.AI_ENABLED = 'false';

    const { config } = await import('../../../src/lib/core/config.js');

    expect(config.IMAP_TLS).toBe(true);
    expect(config.IMAP_ALLOW_INSECURE).toBe(false);
  });

  test('throws naming the field when SCAN_INTERVAL is not numeric', async () => {
    process.env.SCAN_INTERVAL = '5m';
    process.env.AI_ENABLED = 'false';

    await expect(import('../../../src/lib/core/config.js')).rejects.toThrow(
      /SCAN_INTERVAL/
    );
  });

  test('SCAN_INTERVAL defaults to -1 (single-run) when unset', async () => {
    delete process.env.SCAN_INTERVAL;
    process.env.AI_ENABLED = 'false';

    const { config } = await import('../../../src/lib/core/config.js');

    expect(config.SCAN_INTERVAL).toBe(-1);
  });

  test('throws naming the field when SPAM_PROCESSING_MODE is invalid', async () => {
    process.env.SPAM_PROCESSING_MODE = 'delete';
    process.env.AI_ENABLED = 'false';

    await expect(import('../../../src/lib/core/config.js')).rejects.toThrow(
      /SPAM_PROCESSING_MODE/
    );
  });

  test('throws naming AI_API_KEY when AI_ENABLED=true with no key against the default endpoint', async () => {
    process.env.AI_ENABLED = 'true';
    process.env.AI_MODEL = 'gpt-4o-mini';
    delete process.env.AI_API_KEY;
    delete process.env.AI_BASE_URL;

    await expect(import('../../../src/lib/core/config.js')).rejects.toThrow(
      /AI_API_KEY/
    );
  });

  test('does not require AI_API_KEY when AI_BASE_URL is non-default', async () => {
    process.env.AI_ENABLED = 'true';
    process.env.AI_MODEL = 'gpt-4o-mini';
    delete process.env.AI_API_KEY;
    process.env.AI_BASE_URL = 'http://localhost:11434/v1';

    const { config } = await import('../../../src/lib/core/config.js');

    expect(config.AI_BASE_URL).toBe('http://localhost:11434/v1');
  });

  test('throws naming both fields when AI escalation thresholds are inverted', async () => {
    process.env.AI_ENABLED = 'true';
    process.env.AI_MODEL = 'gpt-4o-mini';
    process.env.AI_API_KEY = 'sk-test';
    process.env.AI_ESCALATE_TO_LOW_THRESHOLD = '90';
    process.env.AI_ESCALATE_TO_HIGH_THRESHOLD = '80';

    await expect(import('../../../src/lib/core/config.js')).rejects.toThrow(
      /AI_ESCALATE_TO_LOW_THRESHOLD.*AI_ESCALATE_TO_HIGH_THRESHOLD/s
    );
  });

  test('reports every simultaneous load-time problem in one error, not just the first', async () => {
    process.env.SCAN_INTERVAL = 'not-a-number';
    process.env.SPAM_PROCESSING_MODE = 'delete';
    process.env.AI_ENABLED = 'false';

    let thrown;
    try {
      await import('../../../src/lib/core/config.js');
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeDefined();
    expect(thrown.message).toMatch(/SCAN_INTERVAL/);
    expect(thrown.message).toMatch(/SPAM_PROCESSING_MODE/);
  });

  test('importing config never throws merely because IMAP credentials are unset', async () => {
    delete process.env.IMAP_HOST;
    delete process.env.IMAP_USER;
    delete process.env.IMAP_PASSWORD;
    process.env.AI_ENABLED = 'false';

    await expect(
      import('../../../src/lib/core/config.js')
    ).resolves.toBeDefined();
  });
});

describe('assertRequiredConfig', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  test('throws naming every missing required field', async () => {
    delete process.env.IMAP_HOST;
    delete process.env.IMAP_USER;
    delete process.env.IMAP_PASSWORD;
    process.env.AI_ENABLED = 'false';

    const { assertRequiredConfig } = await import(
      '../../../src/lib/core/config.js'
    );

    let thrown;
    try {
      assertRequiredConfig();
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeDefined();
    expect(thrown.message).toMatch(/IMAP_HOST/);
    expect(thrown.message).toMatch(/IMAP_USER/);
    expect(thrown.message).toMatch(/IMAP_PASSWORD/);
  });

  test('does not throw when all required fields are set', async () => {
    process.env.IMAP_HOST = 'imap.example.com';
    process.env.IMAP_USER = 'user@example.com';
    process.env.IMAP_PASSWORD = 'secret';
    process.env.AI_ENABLED = 'false';

    const { assertRequiredConfig } = await import(
      '../../../src/lib/core/config.js'
    );

    expect(() => assertRequiredConfig()).not.toThrow();
  });
});
