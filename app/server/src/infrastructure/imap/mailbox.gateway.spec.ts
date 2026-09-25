import { describe, test, expect, vi } from 'vitest';
import type { ImapFlow, MailboxObject } from 'imapflow';

vi.mock('./message.mapper.js', () => ({
  processMessage: vi.fn((msg) => ({
    uid: msg.uid,
    flags: msg.flags,
    envelope: msg.envelope,
    raw: msg.source || Buffer.from(''),
  })),
  processMessageHeaders: vi.fn((msg) => ({
    uid: msg.uid,
    headers: { test: 'header' },
  })),
}));

vi.mock('../../domain/utils/mailboxes.js', () => ({
  collectFoldersToCreate: vi.fn((folders: string[], _sep: string) => {
    const result = new Set<string>();
    for (const folder of folders) {
      result.add(folder);
    }
    return result;
  }),
}));

import * as gateway from './mailbox.gateway.js';
import * as mapper from './message.mapper.js';

/**
 * Helper to cast any object to ImapFlow for testing
 */
function asImapFlow(obj: unknown): ImapFlow {
  return obj as ImapFlow;
}

describe('open', () => {
  test('opens folder in read-write mode by default', async () => {
    const mockImap = {
      usable: true,
      mailboxOpen: vi.fn().mockResolvedValue({ exists: 5 }),
    };

    await gateway.open(asImapFlow(mockImap), 'INBOX');

    expect(mockImap.mailboxOpen).toHaveBeenCalledWith('INBOX', {
      readOnly: false,
    });
  });

  test('opens folder in read-only mode when specified', async () => {
    const mockImap = {
      usable: true,
      mailboxOpen: vi.fn().mockResolvedValue({ exists: 5 }),
    };

    await gateway.open(asImapFlow(mockImap), 'Archive', true);

    expect(mockImap.mailboxOpen).toHaveBeenCalledWith('Archive', {
      readOnly: true,
    });
  });

  test('connects if not already connected', async () => {
    const mockImap = {
      usable: false,
      connect: vi.fn().mockResolvedValue(undefined),
      mailboxOpen: vi.fn().mockResolvedValue({ exists: 5 }),
    };

    await gateway.open(asImapFlow(mockImap), 'INBOX');

    expect(mockImap.connect).toHaveBeenCalled();
  });

  test('throws and logs error on failure', async () => {
    const mockImap = {
      usable: true,
      mailboxOpen: vi.fn().mockRejectedValue(new Error('Connection failed')),
    };
    const logger = { error: vi.fn(), debug: vi.fn() };

    await expect(
      gateway.open(asImapFlow(mockImap), 'INBOX', false, logger as any)
    ).rejects.toThrow('Connection failed');

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ folder: 'INBOX' }),
      expect.any(String)
    );
  });
});

describe('count', () => {
  test('returns message count from mailbox object', () => {
    const box = { exists: 42 } as MailboxObject;
    expect(gateway.count(box)).toBe(42);
  });
});

describe('search', () => {
  test('searches messages by query and returns UIDs', async () => {
    const mockImap = {
      search: vi.fn().mockResolvedValue([1, 2, 3]),
    };
    const query = { unseen: true };

    const result = await gateway.search(asImapFlow(mockImap), query);

    expect(result).toEqual([1, 2, 3]);
    expect(mockImap.search).toHaveBeenCalledWith(query, { uid: true });
  });

  test('returns empty array when no messages found', async () => {
    const mockImap = {
      search: vi.fn().mockResolvedValue([]),
    };
    const query = { unseen: true };

    const result = await gateway.search(asImapFlow(mockImap), query);

    expect(result).toEqual([]);
  });

  test('throws and logs error on search failure', async () => {
    const mockImap = {
      search: vi.fn().mockRejectedValue(new Error('Search failed')),
    };
    const logger = { error: vi.fn(), debug: vi.fn() };
    const query = { unseen: true };

    await expect(
      gateway.search(asImapFlow(mockImap), query, logger as any)
    ).rejects.toThrow('Search failed');

    expect(logger.error).toHaveBeenCalled();
  });
});

describe('fetchMessagesByUIDs', () => {
  test('fetches messages by UIDs and maps through processMessage', async () => {
    async function* fakeFetch() {
      yield { uid: 1, flags: ['\\Seen'], envelope: {}, source: Buffer.from('msg1') };
      yield { uid: 2, flags: [], envelope: {}, source: Buffer.from('msg2') };
    }

    const mockImap = {
      fetch: vi.fn().mockReturnValue(fakeFetch()),
    };

    const result = await gateway.fetchMessagesByUIDs(
      asImapFlow(mockImap),
      [1, 2]
    );

    expect(result).toHaveLength(2);
    expect(mockImap.fetch).toHaveBeenCalledWith(
      { uid: '1,2' },
      expect.objectContaining({
        uid: true,
        source: true,
        envelope: true,
        flags: true,
      }),
      { uid: true }
    );
    expect(mapper.processMessage).toHaveBeenCalledTimes(2);
  });

  test('throws and logs error on fetch failure', async () => {
    const mockImap = {
      fetch: vi.fn().mockImplementation(() => {
        throw new Error('Fetch failed');
      }),
    };
    const logger = { error: vi.fn(), debug: vi.fn() };

    await expect(
      gateway.fetchMessagesByUIDs(asImapFlow(mockImap), [1, 2], logger as any)
    ).rejects.toThrow('Fetch failed');

    expect(logger.error).toHaveBeenCalled();
  });
});

describe('fetchMessageHeadersByUIDs', () => {
  test('fetches only headers by UIDs and maps through processMessageHeaders', async () => {
    async function* fakeFetch() {
      yield { uid: 1, headers: Buffer.from('From: a@example.com\r\n\r\n') };
      yield { uid: 2, headers: Buffer.from('From: b@example.com\r\n\r\n') };
    }

    const mockImap = {
      fetch: vi.fn().mockReturnValue(fakeFetch()),
    };

    const result = await gateway.fetchMessageHeadersByUIDs(
      asImapFlow(mockImap),
      [1, 2]
    );

    expect(result).toHaveLength(2);
    expect(mockImap.fetch).toHaveBeenCalledWith(
      { uid: '1,2' },
      { uid: true, headers: true },
      { uid: true }
    );
    expect(mapper.processMessageHeaders).toHaveBeenCalledTimes(2);
  });

  test('throws and logs error on fetch failure', async () => {
    const mockImap = {
      fetch: vi.fn().mockImplementation(() => {
        throw new Error('Fetch headers failed');
      }),
    };
    const logger = { error: vi.fn(), debug: vi.fn() };

    await expect(
      gateway.fetchMessageHeadersByUIDs(asImapFlow(mockImap), [1, 2], logger as any)
    ).rejects.toThrow('Fetch headers failed');

    expect(logger.error).toHaveBeenCalled();
  });
});

describe('moveMessage', () => {
  test('moves a single message by UID and expunges', async () => {
    const mockImap = {
      messageMove: vi.fn().mockResolvedValue(undefined),
      mailboxExpunge: vi.fn().mockResolvedValue(undefined),
    };

    await gateway.moveMessage(asImapFlow(mockImap), 5, 'Archive');

    expect(mockImap.messageMove).toHaveBeenCalledWith({ uid: 5 }, 'Archive');
    expect(mockImap.mailboxExpunge).toHaveBeenCalled();
  });

  test('throws and logs error on move failure', async () => {
    const mockImap = {
      messageMove: vi.fn().mockRejectedValue(new Error('Move failed')),
    };
    const logger = { error: vi.fn(), debug: vi.fn() };

    await expect(
      gateway.moveMessage(asImapFlow(mockImap), 5, 'Archive', logger as any)
    ).rejects.toThrow('Move failed');

    expect(logger.error).toHaveBeenCalled();
  });
});

describe('moveMessages', () => {
  test('moves multiple messages to destination folder', async () => {
    const mockImap = {
      messageMove: vi.fn().mockResolvedValue(undefined),
    };
    const messages = [{ uid: 1 }, { uid: 2 }, { uid: 3 }];

    await gateway.moveMessages(asImapFlow(mockImap), messages, 'Spam');

    expect(mockImap.messageMove).toHaveBeenCalledWith(
      [1, 2, 3],
      'Spam',
      { uid: true }
    );
  });

  test('returns early if messages array is empty', async () => {
    const mockImap = {
      messageMove: vi.fn(),
    };

    await gateway.moveMessages(asImapFlow(mockImap), [], 'Spam');

    expect(mockImap.messageMove).not.toHaveBeenCalled();
  });

  test('throws and logs error on move failure', async () => {
    const mockImap = {
      messageMove: vi.fn().mockRejectedValue(new Error('Batch move failed')),
    };
    const logger = { error: vi.fn(), debug: vi.fn() };
    const messages = [{ uid: 1 }, { uid: 2 }];

    await expect(
      gateway.moveMessages(asImapFlow(mockImap), messages, 'Spam', logger as any)
    ).rejects.toThrow('Batch move failed');

    expect(logger.error).toHaveBeenCalled();
  });
});

describe('appendMessage', () => {
  test('appends message with flags', async () => {
    const mockImap = {
      append: vi.fn().mockResolvedValue(undefined),
    };
    const raw = Buffer.from('test message');

    await gateway.appendMessage(
      asImapFlow(mockImap),
      'Drafts',
      raw,
      ['\\Seen']
    );

    expect(mockImap.append).toHaveBeenCalledWith(
      'Drafts',
      raw,
      ['\\Seen']
    );
  });

  test('appends message without flags by default', async () => {
    const mockImap = {
      append: vi.fn().mockResolvedValue(undefined),
    };
    const raw = 'test message';

    await gateway.appendMessage(asImapFlow(mockImap), 'Drafts', raw);

    expect(mockImap.append).toHaveBeenCalledWith('Drafts', raw, []);
  });

  test('throws and logs error on append failure', async () => {
    const mockImap = {
      append: vi.fn().mockRejectedValue(new Error('Append failed')),
    };
    const logger = { error: vi.fn(), debug: vi.fn() };

    await expect(
      gateway.appendMessage(
        asImapFlow(mockImap),
        'Drafts',
        'test',
        [],
        logger as any
      )
    ).rejects.toThrow('Append failed');

    expect(logger.error).toHaveBeenCalled();
  });
});

describe('updateLabels', () => {
  test('adds and removes labels from messages', async () => {
    const mockImap = {
      messageFlagsAdd: vi.fn().mockResolvedValue(undefined),
      messageFlagsRemove: vi.fn().mockResolvedValue(undefined),
    };
    const messages = [{ uid: 1 }, { uid: 2 }];

    await gateway.updateLabels(
      asImapFlow(mockImap),
      messages,
      ['\\Flagged'],
      ['\\Seen']
    );

    expect(mockImap.messageFlagsAdd).toHaveBeenCalledWith(
      expect.objectContaining({ uid: [1, 2] }),
      ['\\Flagged'],
      { uid: true }
    );
    expect(mockImap.messageFlagsRemove).toHaveBeenCalledWith(
      expect.objectContaining({ uid: [1, 2] }),
      ['\\Seen'],
      { uid: true }
    );
  });

  test('returns early if messages array is empty', async () => {
    const mockImap = {
      messageFlagsAdd: vi.fn(),
      messageFlagsRemove: vi.fn(),
    };

    await gateway.updateLabels(asImapFlow(mockImap), [], ['\\Flagged']);

    expect(mockImap.messageFlagsAdd).not.toHaveBeenCalled();
    expect(mockImap.messageFlagsRemove).not.toHaveBeenCalled();
  });

  test('returns early if no labels to set or unset', async () => {
    const mockImap = {
      messageFlagsAdd: vi.fn(),
      messageFlagsRemove: vi.fn(),
    };
    const messages = [{ uid: 1 }];

    await gateway.updateLabels(asImapFlow(mockImap), messages);

    expect(mockImap.messageFlagsAdd).not.toHaveBeenCalled();
    expect(mockImap.messageFlagsRemove).not.toHaveBeenCalled();
  });

  test('throws and logs error on flag update failure', async () => {
    const mockImap = {
      messageFlagsAdd: vi.fn().mockRejectedValue(new Error('Flag update failed')),
    };
    const logger = { error: vi.fn(), debug: vi.fn() };
    const messages = [{ uid: 1 }];

    await expect(
      gateway.updateLabels(
        asImapFlow(mockImap),
        messages,
        ['\\Flagged'],
        [],
        logger as any
      )
    ).rejects.toThrow('Flag update failed');

    expect(logger.error).toHaveBeenCalled();
  });
});

describe('getImapDelimiter', () => {
  test('returns the folder delimiter from list response', async () => {
    const mockImap = {
      list: vi.fn().mockResolvedValue([
        { delimiter: null },
        { delimiter: '/' },
        { delimiter: '.' },
      ]),
    };

    const result = await gateway.getImapDelimiter(asImapFlow(mockImap));

    expect(result).toBe('/');
  });

  test('returns null if no delimiter found', async () => {
    const mockImap = {
      list: vi.fn().mockResolvedValue([
        { delimiter: null },
        { delimiter: undefined },
      ]),
    };

    const result = await gateway.getImapDelimiter(asImapFlow(mockImap));

    expect(result).toBeNull();
  });
});

describe('createAppFolders', () => {
  test('returns early if folders array is empty', async () => {
    const mockImap = {
      list: vi.fn(),
      mailboxCreate: vi.fn(),
    };

    await gateway.createAppFolders(asImapFlow(mockImap), []);

    expect(mockImap.list).not.toHaveBeenCalled();
  });

  test('creates folders in order', async () => {
    const mockImap = {
      list: vi.fn().mockResolvedValue([{ delimiter: '/' }]),
      mailboxCreate: vi
        .fn()
        .mockResolvedValue({ created: true })
        .mockResolvedValueOnce({ created: false }) // First exists
        .mockResolvedValueOnce({ created: true }), // Second is new
    };

    await gateway.createAppFolders(asImapFlow(mockImap), [
      'INBOX/scanner',
    ]);

    expect(mockImap.mailboxCreate).toHaveBeenCalled();
  });

  test('throws error if no delimiter found', async () => {
    const mockImap = {
      list: vi.fn().mockResolvedValue([{ delimiter: null }]),
    };

    await expect(
      gateway.createAppFolders(asImapFlow(mockImap), ['INBOX/scanner'])
    ).rejects.toThrow('Failed to get folder separator');
  });
});

describe('findFirstUIDOnDate', () => {
  test('finds first UID on or after given date', async () => {
    const mockMessage = {
      uid: 100,
      envelope: {
        date: new Date('2024-01-15T10:00:00Z'),
      },
    };
    const mockImap = {
      mailboxOpen: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue([100, 101, 102]),
      fetchOne: vi.fn().mockResolvedValue(mockMessage),
    };

    const result = await gateway.findFirstUIDOnDate(
      asImapFlow(mockImap),
      'INBOX',
      '2024-01-15'
    );

    expect(result).toEqual({
      last_uid: 100,
      last_seen_date: '2024-01-15T10:00:00.000Z',
      last_checked: expect.any(String),
    });
    expect(mockImap.search).toHaveBeenCalledWith(
      expect.objectContaining({ since: expect.any(Date) })
    );
  });

  test('searches without date criteria when dateString is undefined', async () => {
    const mockMessage = {
      uid: 1,
      envelope: { date: new Date() },
    };
    const mockImap = {
      mailboxOpen: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue([1]),
      fetchOne: vi.fn().mockResolvedValue(mockMessage),
    };

    await gateway.findFirstUIDOnDate(
      asImapFlow(mockImap),
      'INBOX',
      undefined
    );

    expect(mockImap.search).toHaveBeenCalledWith({});
  });

  test('returns null if no messages found', async () => {
    const mockImap = {
      mailboxOpen: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue([]),
    };

    const result = await gateway.findFirstUIDOnDate(
      asImapFlow(mockImap),
      'INBOX',
      '2024-01-15'
    );

    expect(result).toBeNull();
  });

  test('throws and logs error on search failure', async () => {
    const mockImap = {
      mailboxOpen: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockRejectedValue(new Error('Search failed')),
    };
    const logger = { error: vi.fn(), debug: vi.fn() };

    await expect(
      gateway.findFirstUIDOnDate(
        asImapFlow(mockImap),
        'INBOX',
        '2024-01-15',
        logger as any
      )
    ).rejects.toThrow('Search failed');

    expect(logger.error).toHaveBeenCalled();
  });
});
