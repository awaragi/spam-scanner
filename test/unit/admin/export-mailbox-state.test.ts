import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

const { connect, logout, newClient } = vi.hoisted(() => {
  const connect = vi.fn().mockResolvedValue(undefined);
  const logout = vi.fn().mockResolvedValue(undefined);
  return { connect, logout, newClient: vi.fn(() => ({ connect, logout })) };
});

const { writeFile } = vi.hoisted(() => ({ writeFile: vi.fn() }));
const { readScannerState, readMapState } = vi.hoisted(() => ({
  readScannerState: vi.fn(),
  readMapState: vi.fn(),
}));

vi.mock('../../../src/lib/clients/imap.client.ts', () => ({
  newClient,
  safeLogout: (imap: { logout: () => Promise<void> }) => imap.logout(),
}));

vi.mock('fs/promises', () => ({ default: { writeFile } }));

vi.mock('../../../src/lib/clients/state-manager.client.ts', () => ({
  readScannerState,
  readMapState,
  writeScannerState: vi.fn(),
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
  process.argv = ['node', 'export-mailbox-state.ts', ...args];
  vi.resetModules();
  try {
    await import('../../../src/admin/export-mailbox-state.ts');
  } finally {
    process.argv = originalArgv;
  }
}

const SCANNER_STATE = {
  last_uid: 42,
  last_seen_date: '2026-01-01T00:00:00.000Z',
  last_checked: '2026-01-01T00:00:00.000Z',
};

function spyOnStdoutWrite() {
  return vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
}

describe('export-mailbox-state', () => {
  let stdoutSpy: ReturnType<typeof spyOnStdoutWrite>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    stdoutSpy = spyOnStdoutWrite();
    writeFile.mockResolvedValue(undefined);
    readScannerState.mockResolvedValue(SCANNER_STATE);
    readMapState.mockImplementation((_imap: unknown, key: string) =>
      Promise.resolve(
        key === 'rspamd-whitelist-map' ? ['a@b.com'] : ['bad@evil.com']
      )
    );
  });

  afterEach(() => {
    process.exitCode = undefined;
    stdoutSpy.mockRestore();
  });

  test('bundles scannerState, whitelist, and blacklist into one object', async () => {
    await runScript([]);

    const written = JSON.parse(stdoutSpy.mock.calls[0][0] as string);
    expect(written).toEqual({
      scannerState: SCANNER_STATE,
      whitelist: ['a@b.com'],
      blacklist: ['bad@evil.com'],
    });
  });

  test('writes to stdout when --file is omitted', async () => {
    await runScript([]);

    expect(stdoutSpy).toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  test('writes to --file when given', async () => {
    await runScript(['--file', '/tmp/bundle.json']);

    expect(writeFile).toHaveBeenCalledWith(
      '/tmp/bundle.json',
      expect.any(String),
      'utf-8'
    );
    const [, content] = writeFile.mock.calls[0];
    expect(JSON.parse(content)).toEqual({
      scannerState: SCANNER_STATE,
      whitelist: ['a@b.com'],
      blacklist: ['bad@evil.com'],
    });
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  test('reads scanner state, then whitelist, then blacklist sequentially, not concurrently', async () => {
    const callOrder: string[] = [];
    readScannerState.mockImplementation(async () => {
      callOrder.push('scannerState');
      return SCANNER_STATE;
    });
    readMapState.mockImplementation(async (_imap: unknown, key: string) => {
      callOrder.push(key);
      return [];
    });

    await runScript([]);

    expect(callOrder).toEqual([
      'scannerState',
      'rspamd-whitelist-map',
      'rspamd-blacklist-map',
    ]);
  });

  test('always connects and logs out, even on failure', async () => {
    readScannerState.mockRejectedValue(new Error('no state'));

    await runScript([]);

    expect(connect).toHaveBeenCalled();
    expect(logout).toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });
});
