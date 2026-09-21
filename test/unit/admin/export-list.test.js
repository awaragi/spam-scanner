import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

const { connect, logout, newClient } = vi.hoisted(() => {
  const connect = vi.fn().mockResolvedValue();
  const logout = vi.fn().mockResolvedValue();
  return { connect, logout, newClient: vi.fn(() => ({ connect, logout })) };
});

const { writeFile } = vi.hoisted(() => ({ writeFile: vi.fn() }));
const { readMapState } = vi.hoisted(() => ({ readMapState: vi.fn() }));

vi.mock('../../../src/lib/clients/imap.client.js', () => ({
  newClient,
  safeLogout: imap => imap.logout(),
}));

vi.mock('fs/promises', () => ({ default: { writeFile } }));

vi.mock('../../../src/lib/clients/state-manager.client.js', () => ({
  readMapState,
  writeMapState: vi.fn(),
}));

vi.mock('../../../src/lib/core/config.js', () => ({
  config: {
    STATE_KEY_WHITELIST_MAP: 'rspamd-whitelist-map',
    STATE_KEY_BLACKLIST_MAP: 'rspamd-blacklist-map',
  },
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

// export-list.js is a top-level-await script, not an exported function - it
// runs immediately on import, driven by process.argv. Each test re-imports
// it fresh (via vi.resetModules()) with a different argv.
async function runScript(args) {
  const originalArgv = process.argv;
  process.argv = ['node', 'export-list.js', ...args];
  vi.resetModules();
  try {
    await import('../../../src/admin/export-list.js');
  } finally {
    process.argv = originalArgv;
  }
}

describe('export-list', () => {
  let stdoutSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    stdoutSpy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    writeFile.mockResolvedValue();
    readMapState.mockResolvedValue(['a@b.com', 'c@d.com']);
  });

  afterEach(() => {
    process.exitCode = undefined;
    stdoutSpy.mockRestore();
  });

  test('--list whitelist reads from the whitelist state key', async () => {
    await runScript(['--list', 'whitelist']);

    expect(readMapState).toHaveBeenCalledWith(
      expect.anything(),
      'rspamd-whitelist-map'
    );
  });

  test('--list blacklist reads from the blacklist state key', async () => {
    await runScript(['--list', 'blacklist']);

    expect(readMapState).toHaveBeenCalledWith(
      expect.anything(),
      'rspamd-blacklist-map'
    );
  });

  test('txt format (default) writes one address per line to stdout', async () => {
    await runScript(['--list', 'whitelist']);

    expect(stdoutSpy).toHaveBeenCalledWith('a@b.com\nc@d.com\n');
    expect(writeFile).not.toHaveBeenCalled();
  });

  test('json format writes the raw array, pretty-printed, to stdout', async () => {
    await runScript(['--list', 'whitelist', '--format', 'json']);

    expect(stdoutSpy).toHaveBeenCalledWith(
      JSON.stringify(['a@b.com', 'c@d.com'], null, 2)
    );
  });

  test('--file writes to the file instead of stdout', async () => {
    await runScript([
      '--list',
      'whitelist',
      '--format',
      'json',
      '--file',
      '/tmp/whitelist-export.json',
    ]);

    expect(writeFile).toHaveBeenCalledWith(
      '/tmp/whitelist-export.json',
      JSON.stringify(['a@b.com', 'c@d.com'], null, 2),
      'utf-8'
    );
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  test('exporting an empty list produces empty output, not an error', async () => {
    readMapState.mockResolvedValue([]);

    await runScript(['--list', 'whitelist']);

    expect(stdoutSpy).toHaveBeenCalledWith('');
    expect(process.exitCode).toBeUndefined();
  });

  test('exporting an empty list in json format produces an empty array', async () => {
    readMapState.mockResolvedValue([]);

    await runScript(['--list', 'whitelist', '--format', 'json']);

    expect(stdoutSpy).toHaveBeenCalledWith('[]');
  });

  test('always connects and logs out, even on failure', async () => {
    readMapState.mockRejectedValue(new Error('read failed'));

    await runScript(['--list', 'whitelist']);

    expect(connect).toHaveBeenCalled();
    expect(logout).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  test('export --format json then import --format json (override) round-trips the list', async () => {
    // Capture the export's stdout write, then feed it straight into
    // parseAddressList the same way import-list.js would.
    await runScript(['--list', 'whitelist', '--format', 'json']);
    const exported = stdoutSpy.mock.calls[0][0];

    const { parseAddressList } = await import(
      '../../../src/lib/services/sender-lists.service.js'
    );
    const reimported = parseAddressList(exported, 'json');

    expect(reimported).toEqual(['a@b.com', 'c@d.com']);
  });
});
