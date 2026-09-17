import { describe, test, expect, vi, beforeEach } from 'vitest';

const { mockConfig, warn } = vi.hoisted(() => ({
  mockConfig: {
    FOLDER_STATE: 'INBOX.scanner.state',
    STATE_KEY_SCANNER: 'scanner',
    SCAN_INITIAL_STATE: 'new',
  },
  warn: vi.fn(),
}));

vi.mock('../src/lib/utils/config.js', () => ({
  config: mockConfig,
}));

vi.mock('../src/lib/utils/logger.js', () => ({
  rootLogger: {
    forComponent: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn,
      error: vi.fn(),
    }),
  },
}));

vi.mock('../src/lib/clients/imap-client.js', () => ({
  open: vi.fn(),
  search: vi.fn(),
  fetchMessagesByUIDs: vi.fn(),
}));

vi.mock('../src/lib/utils/state-utils.js', () => ({
  formatStateAsEmail: vi.fn(state => `raw-state:${JSON.stringify(state)}`),
  parseStateFromEmail: vi.fn(),
  validateState: vi.fn(),
}));

import {
  readScannerState,
  writeScannerState,
  writeMapState,
} from '../src/lib/state-manager.js';
import {
  open,
  search,
  fetchMessagesByUIDs,
} from '../src/lib/clients/imap-client.js';
import { parseStateFromEmail } from '../src/lib/utils/state-utils.js';

function makeImap(overrides = {}) {
  return {
    mailbox: { path: 'INBOX' },
    mailboxOpen: vi.fn().mockResolvedValue({}),
    append: vi.fn().mockResolvedValue({}),
    messageDelete: vi.fn().mockResolvedValue(true),
    status: vi.fn().mockResolvedValue({ uidNext: 1 }),
    ...overrides,
  };
}

describe('writeScannerState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('append is called before messageDelete (append-before-delete ordering)', async () => {
    const imap = makeImap();
    search.mockResolvedValue([10]);

    const callOrder = [];
    imap.append.mockImplementation(async () => {
      callOrder.push('append');
    });
    imap.messageDelete.mockImplementation(async () => {
      callOrder.push('messageDelete');
    });

    await writeScannerState(imap, {
      last_uid: 1,
      last_seen_date: 'd',
      last_checked: 'c',
    });

    expect(callOrder).toEqual(['append', 'messageDelete']);
    expect(imap.messageDelete).toHaveBeenCalledWith([10], { uid: true });
  });

  test('no previous state: append happens, messageDelete is never called', async () => {
    const imap = makeImap();
    search.mockResolvedValue([]);

    await writeScannerState(imap, {
      last_uid: 1,
      last_seen_date: 'd',
      last_checked: 'c',
    });

    expect(imap.append).toHaveBeenCalled();
    expect(imap.messageDelete).not.toHaveBeenCalled();
  });

  test('append failure: messageDelete is never called, old state message is preserved', async () => {
    const imap = makeImap();
    search.mockResolvedValue([10]);
    imap.append.mockRejectedValue(new Error('connection dropped'));

    await expect(
      writeScannerState(imap, {
        last_uid: 1,
        last_seen_date: 'd',
        last_checked: 'c',
      })
    ).rejects.toThrow('connection dropped');

    expect(imap.messageDelete).not.toHaveBeenCalled();
  });
});

describe('writeMapState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('append is called before messageDelete (append-before-delete ordering)', async () => {
    const imap = makeImap();
    search.mockResolvedValue([20]);

    const callOrder = [];
    imap.append.mockImplementation(async () => {
      callOrder.push('append');
    });
    imap.messageDelete.mockImplementation(async () => {
      callOrder.push('messageDelete');
    });

    await writeMapState(imap, 'rspamd-whitelist-map', 'a@b.com');

    expect(callOrder).toEqual(['append', 'messageDelete']);
    expect(imap.messageDelete).toHaveBeenCalledWith([20], { uid: true });
  });

  test('append failure: messageDelete is never called, old map message is preserved', async () => {
    const imap = makeImap();
    search.mockResolvedValue([20]);
    imap.append.mockRejectedValue(new Error('connection dropped'));

    await expect(
      writeMapState(imap, 'rspamd-whitelist-map', 'a@b.com')
    ).rejects.toThrow('connection dropped');

    expect(imap.messageDelete).not.toHaveBeenCalled();
  });
});

describe('readScannerState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.SCAN_INITIAL_STATE = 'new';
    parseStateFromEmail.mockReturnValue({
      last_uid: 42,
      last_seen_date: 'd',
      last_checked: 'c',
    });
  });

  test('multiple matching state messages: reads the highest-UID one', async () => {
    const imap = makeImap();
    search.mockResolvedValue([5, 12, 8]);
    fetchMessagesByUIDs.mockResolvedValue([{ body: 'raw' }]);

    await readScannerState(imap, undefined);

    expect(fetchMessagesByUIDs).toHaveBeenCalledWith(imap, [12]);
  });

  test('single matching state message: reads it', async () => {
    const imap = makeImap();
    search.mockResolvedValue([7]);
    fetchMessagesByUIDs.mockResolvedValue([{ body: 'raw' }]);

    await readScannerState(imap, undefined);

    expect(fetchMessagesByUIDs).toHaveBeenCalledWith(imap, [7]);
  });

  test('no state, no default: throws', async () => {
    const imap = makeImap();
    search.mockResolvedValue([]);

    await expect(readScannerState(imap, undefined)).rejects.toThrow(
      'Scanner state not found'
    );
  });

  test('no state, default given, no mailboxPath: falls back to the caller-supplied default last_uid unchanged', async () => {
    const imap = makeImap();
    search.mockResolvedValue([]);
    const defaultState = {
      last_uid: 0,
      last_seen_date: 'd',
      last_checked: 'c',
    };

    const result = await readScannerState(imap, defaultState);

    expect(result.last_uid).toBe(0);
    expect(imap.status).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  test('no state, default given, mailboxPath with UIDNEXT > 1: last_uid is UIDNEXT - 1, warns', async () => {
    const imap = makeImap({
      status: vi.fn().mockResolvedValue({ uidNext: 7385 }),
    });
    search.mockResolvedValue([]);
    const defaultState = {
      last_uid: 0,
      last_seen_date: 'd',
      last_checked: 'c',
    };

    const result = await readScannerState(imap, defaultState, 'INBOX');

    expect(imap.status).toHaveBeenCalledWith('INBOX', { uidNext: true });
    expect(result.last_uid).toBe(7384);
    expect(warn).toHaveBeenCalled();
  });

  test('no state, default given, mailboxPath with UIDNEXT === 1 (empty mailbox): last_uid is 0, warns', async () => {
    const imap = makeImap({
      status: vi.fn().mockResolvedValue({ uidNext: 1 }),
    });
    search.mockResolvedValue([]);
    const defaultState = {
      last_uid: 0,
      last_seen_date: 'd',
      last_checked: 'c',
    };

    const result = await readScannerState(imap, defaultState, 'INBOX');

    expect(result.last_uid).toBe(0);
    expect(warn).toHaveBeenCalled();
  });

  test('no state, SCAN_INITIAL_STATE=all, non-empty mailbox: last_uid is 0, UIDNEXT is never checked', async () => {
    mockConfig.SCAN_INITIAL_STATE = 'all';
    const imap = makeImap({
      status: vi.fn().mockResolvedValue({ uidNext: 7385 }),
    });
    search.mockResolvedValue([]);
    const defaultState = {
      last_uid: 0,
      last_seen_date: 'd',
      last_checked: 'c',
    };

    const result = await readScannerState(imap, defaultState, 'INBOX');

    expect(result.last_uid).toBe(0);
    expect(imap.status).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  test('no state, SCAN_INITIAL_STATE=all, no mailboxPath: falls back to the caller-supplied default last_uid unchanged', async () => {
    mockConfig.SCAN_INITIAL_STATE = 'all';
    const imap = makeImap();
    search.mockResolvedValue([]);
    const defaultState = {
      last_uid: 0,
      last_seen_date: 'd',
      last_checked: 'c',
    };

    const result = await readScannerState(imap, defaultState);

    expect(result.last_uid).toBe(0);
    expect(imap.status).not.toHaveBeenCalled();
  });
});
