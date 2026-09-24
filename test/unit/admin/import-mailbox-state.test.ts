import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

const { connect, logout, newClient } = vi.hoisted(() => {
  const connect = vi.fn().mockResolvedValue(undefined);
  const logout = vi.fn().mockResolvedValue(undefined);
  return { connect, logout, newClient: vi.fn(() => ({ connect, logout })) };
});

const { readFile } = vi.hoisted(() => ({ readFile: vi.fn() }));
const { writeScannerState } = vi.hoisted(() => ({
  writeScannerState: vi.fn().mockResolvedValue(true),
}));
const { updateListState } = vi.hoisted(() => ({ updateListState: vi.fn() }));

vi.mock('../../../src/lib/clients/imap.client.ts', () => ({
  newClient,
  safeLogout: (imap: { logout: () => Promise<void> }) => imap.logout(),
}));

vi.mock('fs/promises', () => ({ default: { readFile } }));

vi.mock('../../../src/lib/clients/state-manager.client.ts', () => ({
  writeScannerState,
  readScannerState: vi.fn(),
  readMapState: vi.fn(),
}));

vi.mock('../../../src/lib/controllers/steps/list-update.step.ts', () => ({
  updateListState,
  extractSenderAddresses: vi.fn(),
}));

vi.mock('../../../src/lib/core/config.ts', () => ({
  config: {
    STATE_KEY_WHITELIST_MAP: 'rspamd-whitelist-map',
    STATE_KEY_BLACKLIST_MAP: 'rspamd-blacklist-map',
  },
  assertRequiredConfig: vi.fn(),
}));

vi.mock('../../../src/lib/core/logger.ts', () => ({
  rootLogger: {
    forComponent: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

async function runScript(args: string[]) {
  const originalArgv = process.argv;
  process.argv = ['node', 'import-mailbox-state.ts', ...args];
  vi.resetModules();
  try {
    await import('../../../src/admin/import-mailbox-state.ts');
  } finally {
    process.argv = originalArgv;
  }
}

const SCANNER_STATE = {
  last_uid: 42,
  last_seen_date: '2026-01-01T00:00:00.000Z',
  last_checked: '2026-01-01T00:00:00.000Z',
};

const FULL_BUNDLE = {
  scannerState: SCANNER_STATE,
  whitelist: ['a@b.com'],
  blacklist: ['bad@evil.com'],
};

describe('import-mailbox-state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    writeScannerState.mockResolvedValue(true);
    updateListState.mockResolvedValue({
      added: [],
      skipped: [],
      removed: [],
      total: 0,
    });
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  test('a full bundle restores scanner state and both lists', async () => {
    readFile.mockResolvedValue(JSON.stringify(FULL_BUNDLE));

    await runScript(['--file', '/tmp/bundle.json']);

    expect(writeScannerState).toHaveBeenCalledWith(
      expect.anything(),
      SCANNER_STATE
    );
    expect(updateListState).toHaveBeenCalledWith(
      expect.anything(),
      'rspamd-whitelist-map',
      ['a@b.com'],
      'append'
    );
    expect(updateListState).toHaveBeenCalledWith(
      expect.anything(),
      'rspamd-blacklist-map',
      ['bad@evil.com'],
      'append'
    );
  });

  test('a partial bundle (lists only) leaves scanner state untouched', async () => {
    readFile.mockResolvedValue(
      JSON.stringify({ whitelist: ['a@b.com'], blacklist: [] })
    );

    await runScript(['--file', '/tmp/bundle.json']);

    expect(writeScannerState).not.toHaveBeenCalled();
    expect(updateListState).toHaveBeenCalledTimes(2);
  });

  test('a partial bundle (scanner state only) leaves lists untouched', async () => {
    readFile.mockResolvedValue(JSON.stringify({ scannerState: SCANNER_STATE }));

    await runScript(['--file', '/tmp/bundle.json']);

    expect(writeScannerState).toHaveBeenCalledWith(
      expect.anything(),
      SCANNER_STATE
    );
    expect(updateListState).not.toHaveBeenCalled();
  });

  test('--mode is passed through to updateListState for both lists', async () => {
    readFile.mockResolvedValue(JSON.stringify(FULL_BUNDLE));

    await runScript(['--file', '/tmp/bundle.json', '--mode', 'override']);

    expect(updateListState).toHaveBeenCalledWith(
      expect.anything(),
      'rspamd-whitelist-map',
      ['a@b.com'],
      'override'
    );
    expect(updateListState).toHaveBeenCalledWith(
      expect.anything(),
      'rspamd-blacklist-map',
      ['bad@evil.com'],
      'override'
    );
  });

  test('--mode defaults to append', async () => {
    readFile.mockResolvedValue(JSON.stringify(FULL_BUNDLE));

    await runScript(['--file', '/tmp/bundle.json']);

    expect(updateListState).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'append'
    );
  });

  test('always connects and logs out, even on failure', async () => {
    readFile.mockResolvedValue(JSON.stringify(FULL_BUNDLE));
    writeScannerState.mockRejectedValue(new Error('write failed'));

    await runScript(['--file', '/tmp/bundle.json']);

    expect(connect).toHaveBeenCalled();
    expect(logout).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  test('export then import round-trips the full bundle', async () => {
    // Mirrors export-mailbox-state.ts's output shape directly, without
    // importing that script (it has its own test coverage) - just proves
    // import-mailbox-state.js accepts exactly what it produces.
    const exported = JSON.stringify(FULL_BUNDLE, null, 2);
    readFile.mockResolvedValue(exported);

    await runScript(['--file', '/tmp/bundle.json', '--mode', 'override']);

    expect(writeScannerState).toHaveBeenCalledWith(
      expect.anything(),
      FULL_BUNDLE.scannerState
    );
    expect(updateListState).toHaveBeenCalledWith(
      expect.anything(),
      'rspamd-whitelist-map',
      FULL_BUNDLE.whitelist,
      'override'
    );
    expect(updateListState).toHaveBeenCalledWith(
      expect.anything(),
      'rspamd-blacklist-map',
      FULL_BUNDLE.blacklist,
      'override'
    );
  });
});
