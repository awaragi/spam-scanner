import { describe, test, expect, vi, beforeEach } from 'vitest';
import { asImapFlow } from '../../../test/support/imap-fakes.js';
import { readMapState, writeMapState } from './sender-list.repository.js';

const { mockFetchByUIDs, mockSearch, mockOpen } = vi.hoisted(() => ({
  mockOpen: vi.fn(),
  mockSearch: vi.fn(),
  mockFetchByUIDs: vi.fn(),
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
  formatAppStateEmail: vi.fn((stateKey, body) => `raw-map:${stateKey}:${body}`),
  parseStateFromEmail: vi.fn(),
  validateState: vi.fn(),
}));

import {
  search,
  fetchMessagesByUIDs,
} from '../imap/mailbox.gateway.js';
import {
  parseStateFromEmail,
} from '../../domain/state/state-format.js';

const mockedSearch = vi.mocked(search);
const mockedFetchByUIDs = vi.mocked(fetchMessagesByUIDs);
const mockedParseStateFromEmail = vi.mocked(parseStateFromEmail);

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
 * fetchMessagesByUIDs returns.
 */
function fakeFetched(
  body: string
): Awaited<ReturnType<typeof fetchMessagesByUIDs>> {
  const raw = Buffer.from(`Subject: state\r\n\r\n${body}`);
  return [
    { uid: 1, flags: new Set(), envelope: {}, raw },
  ] as unknown as Awaited<ReturnType<typeof fetchMessagesByUIDs>>;
}

describe('writeMapState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('append is called before messageDelete (append-before-delete ordering)', async () => {
    const imap = makeImap();
    mockedSearch.mockResolvedValue([20]);

    const callOrder: string[] = [];
    imap.append.mockImplementation(async () => {
      callOrder.push('append');
    });
    imap.messageDelete.mockImplementation(async () => {
      callOrder.push('messageDelete');
    });

    await writeMapState(
      asImapFlow(imap),
      'INBOX.state',
      'rspamd-whitelist-map',
      ['a@b.com']
    );

    expect(callOrder).toEqual(['append', 'messageDelete']);
    expect(imap.messageDelete).toHaveBeenCalledWith([20], { uid: true });
  });

  test('append failure: messageDelete is never called, old map message is preserved', async () => {
    const imap = makeImap();
    mockedSearch.mockResolvedValue([20]);
    imap.append.mockRejectedValue(new Error('connection dropped'));

    await expect(
      writeMapState(
        asImapFlow(imap),
        'INBOX.state',
        'rspamd-whitelist-map',
        ['a@b.com']
      )
    ).rejects.toThrow('connection dropped');

    expect(imap.messageDelete).not.toHaveBeenCalled();
  });

  test('no previous state: append happens, messageDelete is never called', async () => {
    const imap = makeImap();
    mockedSearch.mockResolvedValue([]);

    await writeMapState(
      asImapFlow(imap),
      'INBOX.state',
      'rspamd-whitelist-map',
      ['a@b.com']
    );

    expect(imap.append).toHaveBeenCalled();
    expect(imap.messageDelete).not.toHaveBeenCalled();
  });
});

describe('readMapState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('reads back a previously written JSON list', async () => {
    const imap = makeImap();
    mockedSearch.mockResolvedValue([9]);
    mockedFetchByUIDs.mockResolvedValue(fakeFetched('raw'));
    mockedParseStateFromEmail.mockReturnValue(['a@b.com', 'c@d.com']);

    const result = await readMapState(
      asImapFlow(imap),
      'INBOX.state',
      'rspamd-whitelist-map'
    );

    expect(result).toEqual(['a@b.com', 'c@d.com']);
  });

  test('multiple matching state messages: reads the highest-UID one', async () => {
    const imap = makeImap();
    mockedSearch.mockResolvedValue([5, 12, 8]);
    mockedFetchByUIDs.mockResolvedValue(fakeFetched('raw'));
    mockedParseStateFromEmail.mockReturnValue(['a@b.com']);

    await readMapState(
      asImapFlow(imap),
      'INBOX.state',
      'rspamd-whitelist-map'
    );

    expect(mockedFetchByUIDs).toHaveBeenCalledWith(asImapFlow(imap), [12], undefined);
  });

  test('no matching state message: returns [] rather than throwing', async () => {
    const imap = makeImap();
    mockedSearch.mockResolvedValue([]);

    const result = await readMapState(
      asImapFlow(imap),
      'INBOX.state',
      'rspamd-whitelist-map'
    );

    expect(result).toEqual([]);
    expect(mockedFetchByUIDs).not.toHaveBeenCalled();
  });

  test('unparseable JSON body: returns [] rather than throwing', async () => {
    const imap = makeImap();
    mockedSearch.mockResolvedValue([9]);
    mockedFetchByUIDs.mockResolvedValue(fakeFetched('not json'));
    mockedParseStateFromEmail.mockReturnValue(null);

    const result = await readMapState(
      asImapFlow(imap),
      'INBOX.state',
      'rspamd-whitelist-map'
    );

    expect(result).toEqual([]);
  });

  test('JSON body that is not an array (e.g. a legacy plain-text backup): returns []', async () => {
    const imap = makeImap();
    mockedSearch.mockResolvedValue([9]);
    mockedFetchByUIDs.mockResolvedValue(fakeFetched('a@b.com\nc@d.com'));
    mockedParseStateFromEmail.mockReturnValue({ type: 'object' });

    const result = await readMapState(
      asImapFlow(imap),
      'INBOX.state',
      'rspamd-whitelist-map'
    );

    expect(result).toEqual([]);
  });
});
