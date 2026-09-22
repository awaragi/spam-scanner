import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import { configGroups } from '../../../src/lib/core/config.js';
import { renderEnvFile } from '../../../src/lib/utils/env-file.util.js';

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
    process.env.IMAP_USER = 'owner@example.com';

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

  test('SCAN_INTERVAL defaults to 0 (IDLE mode) when unset', async () => {
    delete process.env.SCAN_INTERVAL;
    process.env.AI_ENABLED = 'false';

    const { config } = await import('../../../src/lib/core/config.js');

    expect(config.SCAN_INTERVAL).toBe(0);
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
    process.env.IMAP_USER = 'owner@example.com';

    const { config } = await import('../../../src/lib/core/config.js');

    expect(config.AI_BASE_URL).toBe('http://localhost:11434/v1');
  });

  test('throws naming both fields when AI escalation thresholds are inverted', async () => {
    process.env.AI_ENABLED = 'true';
    process.env.AI_MODEL = 'gpt-4o-mini';
    process.env.AI_API_KEY = 'sk-test';
    process.env.AI_ESCALATE_TO_LOW_THRESHOLD = '90';
    process.env.AI_ESCALATE_TO_HIGH_THRESHOLD = '80';
    process.env.IMAP_USER = 'owner@example.com';

    await expect(import('../../../src/lib/core/config.js')).rejects.toThrow(
      /AI_ESCALATE_TO_LOW_THRESHOLD.*AI_ESCALATE_TO_HIGH_THRESHOLD/s
    );
  });

  test('throws naming IMAP_NOTIFY_ADDRESS when AI_ENABLED=true and IMAP_USER is not an email address', async () => {
    process.env.AI_ENABLED = 'true';
    process.env.AI_MODEL = 'gpt-4o-mini';
    process.env.AI_API_KEY = 'sk-test';
    process.env.IMAP_USER = 'pierre';
    delete process.env.IMAP_NOTIFY_ADDRESS;

    await expect(import('../../../src/lib/core/config.js')).rejects.toThrow(
      /IMAP_NOTIFY_ADDRESS/
    );
  });

  test('does not require IMAP_NOTIFY_ADDRESS when IMAP_USER is itself an email address', async () => {
    process.env.AI_ENABLED = 'true';
    process.env.AI_MODEL = 'gpt-4o-mini';
    process.env.AI_API_KEY = 'sk-test';
    process.env.IMAP_USER = 'owner@example.com';
    delete process.env.IMAP_NOTIFY_ADDRESS;

    const { config } = await import('../../../src/lib/core/config.js');

    expect(config.IMAP_NOTIFY_ADDRESS).toBe('');
  });

  test('does not require IMAP_NOTIFY_ADDRESS to match IMAP_USER when explicitly set, even with a bare-username IMAP_USER', async () => {
    process.env.AI_ENABLED = 'true';
    process.env.AI_MODEL = 'gpt-4o-mini';
    process.env.AI_API_KEY = 'sk-test';
    process.env.IMAP_USER = 'pierre';
    process.env.IMAP_NOTIFY_ADDRESS = 'pierre@example.com';

    const { config } = await import('../../../src/lib/core/config.js');

    expect(config.IMAP_NOTIFY_ADDRESS).toBe('pierre@example.com');
  });

  test('does not require IMAP_NOTIFY_ADDRESS when AI_ENABLED=false, regardless of IMAP_USER', async () => {
    process.env.AI_ENABLED = 'false';
    delete process.env.IMAP_USER;
    delete process.env.IMAP_NOTIFY_ADDRESS;

    const { config } = await import('../../../src/lib/core/config.js');

    expect(config.IMAP_NOTIFY_ADDRESS).toBe('');
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

describe('configGroups -> .env.example sync', () => {
  // Guards against exactly the kind of drift this generator exists to
  // prevent (a config.js default changed without regenerating .env.example,
  // or vice versa) - see src/cli/generate-env-example.js.
  test('the committed .env.example matches what configGroups renders', () => {
    const repoRoot = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../..'
    );
    const committed = readFileSync(resolve(repoRoot, '.env.example'), 'utf8');

    expect(committed).toBe(renderEnvFile(configGroups));
  });
});
