import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

const { connect, logout, newClient } = vi.hoisted(() => {
  const connect = vi.fn().mockResolvedValue();
  const logout = vi.fn().mockResolvedValue();
  return { connect, logout, newClient: vi.fn(() => ({ connect, logout })) };
});

const { readFile } = vi.hoisted(() => ({ readFile: vi.fn() }));
const { updateListState } = vi.hoisted(() => ({ updateListState: vi.fn() }));

vi.mock('../../../src/lib/clients/imap.client.js', () => ({
  newClient,
  safeLogout: imap => imap.logout(),
}));

vi.mock('fs/promises', () => ({ default: { readFile } }));

vi.mock('../../../src/lib/controllers/steps/list-update.step.js', () => ({
  updateListState,
  extractSenderAddresses: vi.fn(),
}));

vi.mock('../../../src/lib/core/config.js', () => ({
  config: {
    STATE_KEY_WHITELIST_MAP: 'rspamd-whitelist-map',
    STATE_KEY_BLACKLIST_MAP: 'rspamd-blacklist-map',
  },
  assertRequiredConfig: vi.fn(),
}));

vi.mock('../../../src/lib/core/logger.js', () => ({
  rootLogger: {
    forComponent: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

// import-list.js is a top-level-await script, not an exported function - it
// runs immediately on import, driven by process.argv. Each test re-imports
// it fresh (via vi.resetModules()) with a different argv.
async function runScript(args) {
  const originalArgv = process.argv;
  process.argv = ['node', 'import-list.js', ...args];
  vi.resetModules();
  try {
    await import('../../../src/admin/import-list.js');
  } finally {
    process.argv = originalArgv;
  }
}

describe('import-list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    updateListState.mockResolvedValue({
      added: [],
      skipped: [],
      removed: [],
      total: 0,
    });
    readFile.mockResolvedValue('a@b.com\n');
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  test('--list whitelist writes to the whitelist state key', async () => {
    await runScript([
      '--list',
      'whitelist',
      '--file',
      '/tmp/whitelist.map',
      '--mode',
      'append',
    ]);

    expect(updateListState).toHaveBeenCalledWith(
      expect.anything(),
      'rspamd-whitelist-map',
      ['a@b.com'],
      'append'
    );
    expect(process.exitCode).toBeUndefined();
  });

  test('--list blacklist writes to the blacklist state key', async () => {
    await runScript([
      '--list',
      'blacklist',
      '--file',
      '/tmp/blacklist.map',
      '--mode',
      'append',
    ]);

    expect(updateListState).toHaveBeenCalledWith(
      expect.anything(),
      'rspamd-blacklist-map',
      ['a@b.com'],
      'append'
    );
  });

  test('--mode append is passed through to updateListState', async () => {
    await runScript([
      '--list',
      'whitelist',
      '--file',
      '/tmp/whitelist.map',
      '--mode',
      'append',
    ]);

    expect(updateListState).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'append'
    );
  });

  test('--mode override is passed through to updateListState', async () => {
    await runScript([
      '--list',
      'whitelist',
      '--file',
      '/tmp/whitelist.map',
      '--mode',
      'override',
    ]);

    expect(updateListState).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'override'
    );
  });

  test('--mode defaults to append when omitted', async () => {
    await runScript(['--list', 'whitelist', '--file', '/tmp/whitelist.map']);

    expect(updateListState).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'append'
    );
  });

  test('source file addresses are normalized before being passed to updateListState', async () => {
    readFile.mockResolvedValue('  A@B.com  \nnot-an-address\nc@d.com\n');

    await runScript([
      '--list',
      'whitelist',
      '--file',
      '/tmp/whitelist.map',
      '--mode',
      'append',
    ]);

    expect(updateListState).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      ['a@b.com', 'c@d.com'],
      'append'
    );
  });

  test('--format defaults to txt (newline-delimited)', async () => {
    readFile.mockResolvedValue('a@b.com\nc@d.com\n');

    await runScript(['--list', 'whitelist', '--file', '/tmp/whitelist.map']);

    expect(updateListState).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      ['a@b.com', 'c@d.com'],
      'append'
    );
  });

  test('--format json parses a JSON array and normalizes each entry', async () => {
    readFile.mockResolvedValue(JSON.stringify(['A@B.com', ' c@d.com ']));

    await runScript([
      '--list',
      'whitelist',
      '--file',
      '/tmp/whitelist.json',
      '--format',
      'json',
    ]);

    expect(updateListState).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      ['a@b.com', 'c@d.com'],
      'append'
    );
  });

  test('--format json with invalid JSON content fails cleanly (connects and logs out, exit code 1)', async () => {
    readFile.mockResolvedValue('not json');

    await runScript([
      '--list',
      'whitelist',
      '--file',
      '/tmp/whitelist.json',
      '--format',
      'json',
    ]);

    expect(updateListState).not.toHaveBeenCalled();
    expect(logout).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  test('running append mode twice against the same file is idempotent', async () => {
    readFile.mockResolvedValue('a@b.com\nA@B.com\n');
    let stored = [];
    updateListState.mockImplementation(async (imap, key, addresses, mode) => {
      const normalized = [...new Set(addresses)];
      stored =
        mode === 'override'
          ? normalized
          : [...new Set([...stored, ...normalized])];
      return { added: [], skipped: [], removed: [], total: stored.length };
    });

    await runScript([
      '--list',
      'whitelist',
      '--file',
      '/tmp/whitelist.map',
      '--mode',
      'append',
    ]);
    const firstStored = [...stored];

    await runScript([
      '--list',
      'whitelist',
      '--file',
      '/tmp/whitelist.map',
      '--mode',
      'append',
    ]);
    const secondStored = [...stored];

    expect(secondStored).toEqual(firstStored);
    expect(updateListState.mock.calls[0][2]).toEqual(
      updateListState.mock.calls[1][2]
    );
  });

  test('always connects and logs out, even on failure', async () => {
    updateListState.mockRejectedValue(new Error('write failed'));

    await runScript([
      '--list',
      'whitelist',
      '--file',
      '/tmp/whitelist.map',
      '--mode',
      'append',
    ]);

    expect(connect).toHaveBeenCalled();
    expect(logout).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});
