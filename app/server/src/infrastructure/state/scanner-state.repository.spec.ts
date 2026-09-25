import { describe, test, expect, vi, beforeEach } from 'vitest';
import { asImapFlow } from '../../../test/support/imap-fakes.js';
import {
  readScannerState,
  writeScannerState,
  deleteScannerState,
} from './scanner-state.repository.js';

const { mockFetchByUIDs, mockSearch, mockOpen, warn } = vi.hoisted(() => ({
  mockOpen: vi.fn(),
  mockSearch: vi.fn(),
  mockFetchByUIDs: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../imap/mailbox.gateway.js', () => ({
  open: mockOpen,
  search: mockSearch,
  fetchMessagesByUIDs: mockFetchByUIDs,
}));

vi.mock('../../domain/state/state-format.js', () => ({
  STATE_KEY_SCANNER: 'scanner',
  STATE_KEY_WHITELIST_MAP: 'rspamd-whitelist-map',
  STATE_KEY_BLACKLIST_MAP: 'rspamd-blacklist-map',
  formatStateAsEmail: vi.fn((state) => `raw-state:${JSON.stringify(state)}`),
  parseStateFromEmail: vi.fn(),
  validateState: vi.fn(),
}));

import {
  search,
  fetchMessagesByUIDs,
} from '../imap/mailbox.gateway.js';
import {
  parseStateFromEmail,
  validateState,
} from '../../domain/state/state-format.js';

const mockedSearch = vi.mocked(search);
const mockedFetchByUIDs = vi.mocked(fetchMessagesByUIDs);
const mockedParseStateFromEmail = vi.mocked(parseStateFromEmail);
const mockedValidateState = vi.mocked(validateState);

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

/**
 * Build a fake RFC822 message with a body, simulating the raw buffer that
 * fetchMessagesByUIDs returns. State messages are formatted by formatStateAsEmail,
 * so the JSON payload parseStateFromEmail expects is everything after the
 * headers blank line.
 */
function fakeFetched(
  body: string
): Awaited<ReturnType<typeof fetchMessagesByUIDs>> {
  const raw = Buffer.from(`Subject: state\r\n\r\n${body}`);
  return [
    { uid: 1, flags: new Set(), envelope: {}, raw },
  ] as unknown as Awaited<ReturnType<typeof fetchMessagesByUIDs>>;
}

describe('writeScannerState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('append is called before messageDelete (append-before-delete ordering)', async () => {
    const imap = makeImap();
    mockedSearch.mockResolvedValue([10]);

    const callOrder: string[] = [];
    imap.append.mockImplementation(async () => {
      callOrder.push('append');
    });
    imap.messageDelete.mockImplementation(async () => {
      callOrder.push('messageDelete');
    });

    await writeScannerState(asImapFlow(imap), 'INBOX.state', {
      last_uid: 1,
      last_seen_date: 'd',
      last_checked: 'c',
    });

    expect(callOrder).toEqual(['append', 'messageDelete']);
    expect(imap.messageDelete).toHaveBeenCalledWith([10], { uid: true });
  });

  test('no previous state: append happens, messageDelete is never called', async () => {
    const imap = makeImap();
    mockedSearch.mockResolvedValue([]);

    await writeScannerState(asImapFlow(imap), 'INBOX.state', {
      last_uid: 1,
      last_seen_date: 'd',
      last_checked: 'c',
    });

    expect(imap.append).toHaveBeenCalled();
    expect(imap.messageDelete).not.toHaveBeenCalled();
  });

  test('append failure: messageDelete is never called, old state message is preserved', async () => {
    const imap = makeImap();
    mockedSearch.mockResolvedValue([10]);
    imap.append.mockRejectedValue(new Error('connection dropped'));

    await expect(
      writeScannerState(asImapFlow(imap), 'INBOX.state', {
        last_uid: 1,
        last_seen_date: 'd',
        last_checked: 'c',
      })
    ).rejects.toThrow('connection dropped');

    expect(imap.messageDelete).not.toHaveBeenCalled();
  });
});

describe('readScannerState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedParseStateFromEmail.mockReturnValue({
      last_uid: 42,
      last_seen_date: 'd',
      last_checked: 'c',
    });
  });

  test('multiple matching state messages: reads the highest-UID one', async () => {
    const imap = makeImap();
    mockedSearch.mockResolvedValue([5, 12, 8]);
    mockedFetchByUIDs.mockResolvedValue(fakeFetched('raw'));

    await readScannerState(asImapFlow(imap), 'INBOX.state');

    expect(mockedFetchByUIDs).toHaveBeenCalledWith(asImapFlow(imap), [12], undefined);
  });

  test('single matching state message: reads it', async () => {
    const imap = makeImap();
    mockedSearch.mockResolvedValue([7]);
    mockedFetchByUIDs.mockResolvedValue(fakeFetched('raw'));

    await readScannerState(asImapFlow(imap), 'INBOX.state');

    expect(mockedFetchByUIDs).toHaveBeenCalledWith(asImapFlow(imap), [7], undefined);
  });

  test('extracts the JSON body from the full raw RFC822 message, not a nonexistent .body field', async () => {
    const imap = makeImap();
    mockedSearch.mockResolvedValue([7]);
    const stateJson = JSON.stringify({
      last_uid: 99,
      last_seen_date: 'd',
      last_checked: 'c',
    });
    const raw = Buffer.from(
      `From: Scanner State <scanner@localhost>\r\nSubject: AppState: scanner\r\nX-App-State: scanner\r\nContent-Type: text/plain; charset=utf-8\r\nMIME-Version: 1.0\r\n\r\n${stateJson}`
    );
    mockedFetchByUIDs.mockResolvedValue([
      { uid: 7, flags: new Set(), envelope: {}, raw },
    ] as unknown as Awaited<ReturnType<typeof fetchMessagesByUIDs>>);

    await readScannerState(asImapFlow(imap), 'INBOX.state');

    expect(mockedParseStateFromEmail).toHaveBeenCalledWith(stateJson);
  });

  test('unparseable state message: throws "Failed to parse"', async () => {
    const imap = makeImap();
    mockedSearch.mockResolvedValue([7]);
    mockedFetchByUIDs.mockResolvedValue(fakeFetched('not json'));
    mockedParseStateFromEmail.mockReturnValue(null);

    await expect(readScannerState(asImapFlow(imap), 'INBOX.state')).rejects.toThrow(
      'Failed to parse state from email'
    );
    expect(mockedValidateState).not.toHaveBeenCalled();
  });

  test('no state, no default: throws', async () => {
    const imap = makeImap();
    mockedSearch.mockResolvedValue([]);

    await expect(readScannerState(asImapFlow(imap), 'INBOX.state')).rejects.toThrow(
      'Scanner state not found'
    );
  });

  test('no state, default given, no mailboxPath: falls back to the caller-supplied default last_uid unchanged', async () => {
    const imap = makeImap();
    mockedSearch.mockResolvedValue([]);
    const defaultState = {
      last_uid: 0,
      last_seen_date: 'd',
      last_checked: 'c',
    };

    const result = await readScannerState(
      asImapFlow(imap),
      'INBOX.state',
      defaultState,
      undefined,
      'new',
      { warn } as any
    );

    expect(result.last_uid).toBe(0);
    expect(imap.status).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  test('no state, default given, mailboxPath with UIDNEXT > 1: last_uid is UIDNEXT - 1, warns', async () => {
    const imap = makeImap({
      status: vi.fn().mockResolvedValue({ uidNext: 7385 }),
    });
    mockedSearch.mockResolvedValue([]);
    const defaultState = {
      last_uid: 0,
      last_seen_date: 'd',
      last_checked: 'c',
    };

    const result = await readScannerState(
      asImapFlow(imap),
      'INBOX.state',
      defaultState,
      'INBOX',
      'new',
      { warn } as any
    );

    expect(imap.status).toHaveBeenCalledWith('INBOX', { uidNext: true });
    expect(result.last_uid).toBe(7384);
    expect(warn).toHaveBeenCalled();
  });

  test('no state, default given, mailboxPath with UIDNEXT === 1 (empty mailbox): last_uid is 0, warns', async () => {
    const imap = makeImap({
      status: vi.fn().mockResolvedValue({ uidNext: 1 }),
    });
    mockedSearch.mockResolvedValue([]);
    const defaultState = {
      last_uid: 0,
      last_seen_date: 'd',
      last_checked: 'c',
    };

    const result = await readScannerState(
      asImapFlow(imap),
      'INBOX.state',
      defaultState,
      'INBOX',
      'new',
      { warn } as any
    );

    expect(result.last_uid).toBe(0);
    expect(warn).toHaveBeenCalled();
  });

  test('no state, SCAN_INITIAL_STATE=all, non-empty mailbox: last_uid is 0, UIDNEXT is never checked', async () => {
    const imap = makeImap({
      status: vi.fn().mockResolvedValue({ uidNext: 7385 }),
    });
    mockedSearch.mockResolvedValue([]);
    const defaultState = {
      last_uid: 0,
      last_seen_date: 'd',
      last_checked: 'c',
    };

    const result = await readScannerState(
      asImapFlow(imap),
      'INBOX.state',
      defaultState,
      'INBOX',
      'all',
      { warn } as any
    );

    expect(result.last_uid).toBe(0);
    expect(imap.status).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  test('no state, SCAN_INITIAL_STATE=all, no mailboxPath: falls back to the caller-supplied default last_uid unchanged', async () => {
    const imap = makeImap();
    mockedSearch.mockResolvedValue([]);
    const defaultState = {
      last_uid: 0,
      last_seen_date: 'd',
      last_checked: 'c',
    };

    const result = await readScannerState(
      asImapFlow(imap),
      'INBOX.state',
      defaultState,
      undefined,
      'all'
    );

    expect(result.last_uid).toBe(0);
    expect(imap.status).not.toHaveBeenCalled();
  });
});

describe('deleteScannerState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('deletes scanner state messages by UID', async () => {
    const imap = makeImap();
    mockedSearch.mockResolvedValue([5, 10, 15]);

    const result = await deleteScannerState(asImapFlow(imap), 'INBOX.state');

    expect(result).toBe(true);
    expect(imap.messageDelete).toHaveBeenCalledWith([5, 10, 15], { uid: true });
  });

  test('returns false when no state messages exist', async () => {
    const imap = makeImap();
    mockedSearch.mockResolvedValue([]);

    const result = await deleteScannerState(asImapFlow(imap), 'INBOX.state');

    expect(result).toBe(false);
    expect(imap.messageDelete).not.toHaveBeenCalled();
  });
});
