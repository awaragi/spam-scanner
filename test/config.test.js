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

    const { config } = await import('../src/lib/utils/config.js');

    expect(config.SPAM_PROCESSING_MODE).toBe('folder');
  });

  test('AI_MODEL has no default: empty when AI is disabled and unset', async () => {
    delete process.env.AI_MODEL;
    process.env.AI_ENABLED = 'false';

    const { config } = await import('../src/lib/utils/config.js');

    expect(config.AI_MODEL).toBe('');
  });

  test('throws at load time when AI_ENABLED=true and AI_MODEL is unset', async () => {
    delete process.env.AI_MODEL;
    process.env.AI_ENABLED = 'true';

    await expect(import('../src/lib/utils/config.js')).rejects.toThrow(
      /AI_MODEL/
    );
  });

  test('does not throw when AI_ENABLED=true and AI_MODEL is set', async () => {
    process.env.AI_MODEL = 'gpt-4o-mini';
    process.env.AI_ENABLED = 'true';

    const { config } = await import('../src/lib/utils/config.js');

    expect(config.AI_MODEL).toBe('gpt-4o-mini');
  });

  test('SCAN_INITIAL_STATE defaults to "new" when unset', async () => {
    delete process.env.SCAN_INITIAL_STATE;
    process.env.AI_ENABLED = 'false';

    const { config } = await import('../src/lib/utils/config.js');

    expect(config.SCAN_INITIAL_STATE).toBe('new');
  });

  test('SCAN_INITIAL_STATE accepts "all" (case-insensitive)', async () => {
    process.env.SCAN_INITIAL_STATE = 'ALL';
    process.env.AI_ENABLED = 'false';

    const { config } = await import('../src/lib/utils/config.js');

    expect(config.SCAN_INITIAL_STATE).toBe('all');
  });

  test('throws at load time when SCAN_INITIAL_STATE is neither "new" nor "all"', async () => {
    process.env.SCAN_INITIAL_STATE = 'everything';
    process.env.AI_ENABLED = 'false';

    await expect(import('../src/lib/utils/config.js')).rejects.toThrow(
      /SCAN_INITIAL_STATE/
    );
  });
});
