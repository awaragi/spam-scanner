import { describe, test, expect, vi, beforeEach } from 'vitest';
import { asImapFlow } from '../../../test/support/imap-fakes.js';
import {
  readSettingsOverrides,
  writeSettingsOverrides,
} from './mailbox-settings.repository.js';
import {
  formatAppStateEmail,
  STATE_KEY_MAILBOX_SETTINGS,
} from '../../domain/state/state-format.js';

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

import {
  search,
  fetchMessagesByUIDs,
} from '../imap/mailbox.gateway.js';

const mockedSearch = vi.mocked(search);
const mockedFetchByUIDs = vi.mocked(fetchMessagesByUIDs);

function makeImap(overrides = {}) {
  return {
    mailbox: { path: 'INBOX' },
    mailboxOpen: vi.fn().mockResolvedValue({}),
    append: vi.fn().mockResolvedValue({}),
    messageDelete: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

/**
 * Build a fake RFC822 message from a full raw message string (headers +
 * body), simulating the raw buffer that fetchMessagesByUIDs returns.
 */
function fakeMessage(
  raw: string,
  uid = 1
): Awaited<ReturnType<typeof fetchMessagesByUIDs>> {
  return [
    { uid, flags: new Set(), envelope: {}, raw: Buffer.from(raw) },
  ] as unknown as Awaited<ReturnType<typeof fetchMessagesByUIDs>>;
}

function settingsMessage(body: string): string {
  return formatAppStateEmail(STATE_KEY_MAILBOX_SETTINGS, body, 'Mailbox Settings');
}

describe('readSettingsOverrides', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOpen.mockResolvedValue({});
  });

  test('no settings message exists: returns undefined without logging', async () => {
    const imap = makeImap();
    mockedSearch.mockResolvedValue([]);
    const warn = vi.fn();

    const result = await readSettingsOverrides(
      asImapFlow(imap),
      'INBOX.state',
      { warn } as any
    );

    expect(result).toBeUndefined();
    expect(mockedFetchByUIDs).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  test('a valid JSON object message exists: returns that exact object', async () => {
    const imap = makeImap();
    const overrides = { thresholds: { clean: 10 }, aiEnabled: false };
    mockedSearch.mockResolvedValue([9]);
    mockedFetchByUIDs.mockResolvedValue(
      fakeMessage(settingsMessage(JSON.stringify(overrides)), 9)
    );

    const result = await readSettingsOverrides(asImapFlow(imap), 'INBOX.state');

    expect(result).toEqual(overrides);
  });

  test('a message whose body is not valid JSON: returns undefined and logs a warning', async () => {
    const imap = makeImap();
    mockedSearch.mockResolvedValue([9]);
    mockedFetchByUIDs.mockResolvedValue(
      fakeMessage(settingsMessage('not json'), 9)
    );
    const warn = vi.fn();

    const result = await readSettingsOverrides(
      asImapFlow(imap),
      'INBOX.state',
      { warn } as any
    );

    expect(result).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test('a message whose body is valid JSON but not an object (array): returns undefined and logs a warning', async () => {
    const imap = makeImap();
    mockedSearch.mockResolvedValue([9]);
    mockedFetchByUIDs.mockResolvedValue(
      fakeMessage(settingsMessage(JSON.stringify([1, 2, 3])), 9)
    );
    const warn = vi.fn();

    const result = await readSettingsOverrides(
      asImapFlow(imap),
      'INBOX.state',
      { warn } as any
    );

    expect(result).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test('a message whose body is valid JSON but not an object (number): returns undefined and logs a warning', async () => {
    const imap = makeImap();
    mockedSearch.mockResolvedValue([9]);
    mockedFetchByUIDs.mockResolvedValue(
      fakeMessage(settingsMessage(JSON.stringify(5)), 9)
    );
    const warn = vi.fn();

    const result = await readSettingsOverrides(
      asImapFlow(imap),
      'INBOX.state',
      { warn } as any
    );

    expect(result).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test('a message whose body is valid JSON null: returns undefined and logs a warning', async () => {
    const imap = makeImap();
    mockedSearch.mockResolvedValue([9]);
    mockedFetchByUIDs.mockResolvedValue(
      fakeMessage(settingsMessage(JSON.stringify(null)), 9)
    );
    const warn = vi.fn();

    const result = await readSettingsOverrides(
      asImapFlow(imap),
      'INBOX.state',
      { warn } as any
    );

    expect(result).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test('interrupted write: two settings messages present, the higher-UID one wins', async () => {
    const imap = makeImap();
    mockedSearch.mockResolvedValue([5, 12, 8]);
    mockedFetchByUIDs.mockImplementation(async (_imap, uids) => {
      const uid = uids[0];
      const body =
        uid === 12 ? { later: true } : { earlier: true, wrong: uid };
      return fakeMessage(settingsMessage(JSON.stringify(body)), uid);
    });

    const result = await readSettingsOverrides(asImapFlow(imap), 'INBOX.state');

    expect(mockedFetchByUIDs).toHaveBeenCalledWith(
      asImapFlow(imap),
      [12],
      undefined
    );
    expect(result).toEqual({ later: true });
  });
});

describe('writeSettingsOverrides', () => {
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

    await writeSettingsOverrides(asImapFlow(imap), 'INBOX.state', {
      aiEnabled: false,
    });

    expect(callOrder).toEqual(['append', 'messageDelete']);
    expect(imap.messageDelete).toHaveBeenCalledWith([20], { uid: true });
  });

  test('no previous settings message: append happens, messageDelete is never called', async () => {
    const imap = makeImap();
    mockedSearch.mockResolvedValue([]);

    await writeSettingsOverrides(asImapFlow(imap), 'INBOX.state', {
      aiEnabled: false,
    });

    expect(imap.append).toHaveBeenCalled();
    expect(imap.messageDelete).not.toHaveBeenCalled();
  });

  test('append failure: messageDelete is never called, old settings message is preserved', async () => {
    const imap = makeImap();
    mockedSearch.mockResolvedValue([20]);
    imap.append.mockRejectedValue(new Error('connection dropped'));

    await expect(
      writeSettingsOverrides(asImapFlow(imap), 'INBOX.state', {
        aiEnabled: false,
      })
    ).rejects.toThrow('connection dropped');

    expect(imap.messageDelete).not.toHaveBeenCalled();
  });
});

describe('write then read round-trip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOpen.mockResolvedValue({});
  });

  test('a write followed by a read returns exactly what was written', async () => {
    const overrides = { thresholds: { clean: 12 }, processingMode: 'label' };

    const writeImap = makeImap();
    mockedSearch.mockResolvedValueOnce([]);
    await writeSettingsOverrides(asImapFlow(writeImap), 'INBOX.state', overrides);

    const appendedRaw = writeImap.append.mock.calls[0][1] as string;

    const readImap = makeImap();
    mockedSearch.mockResolvedValueOnce([1]);
    mockedFetchByUIDs.mockResolvedValueOnce(fakeMessage(appendedRaw, 1));

    const result = await readSettingsOverrides(asImapFlow(readImap), 'INBOX.state');

    expect(result).toEqual(overrides);
  });

  test('a second write leaves exactly one settings message behind (old one deleted)', async () => {
    const imap = makeImap();

    // First write: no prior message.
    mockedSearch.mockResolvedValueOnce([]);
    await writeSettingsOverrides(asImapFlow(imap), 'INBOX.state', {
      aiEnabled: false,
    });
    const firstRaw = imap.append.mock.calls[0][1] as string;
    expect(imap.messageDelete).not.toHaveBeenCalled();

    // Second write: the first message (UID 1) is now the existing one.
    mockedSearch.mockResolvedValueOnce([1]);
    await writeSettingsOverrides(asImapFlow(imap), 'INBOX.state', {
      aiEnabled: true,
    });
    const secondRaw = imap.append.mock.calls[1][1] as string;

    // The old message was actually deleted, not just shadowed.
    expect(imap.messageDelete).toHaveBeenCalledWith([1], { uid: true });
    expect(firstRaw).not.toEqual(secondRaw);

    // Reading afterward (only the second message, UID 2, remains) returns
    // only the latest content.
    mockedSearch.mockResolvedValueOnce([2]);
    mockedFetchByUIDs.mockResolvedValueOnce(fakeMessage(secondRaw, 2));

    const result = await readSettingsOverrides(asImapFlow(imap), 'INBOX.state');

    expect(result).toEqual({ aiEnabled: true });
  });
});
