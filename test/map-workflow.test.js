import { describe, test, expect, vi, beforeEach } from 'vitest';

const { mockConfig, error } = vi.hoisted(() => ({
  mockConfig: {
    FOLDER_TRAIN_WHITELIST: 'INBOX.scanner.train.whitelist',
    FOLDER_TRAIN_BLACKLIST: 'INBOX.scanner.train.blacklist',
    FOLDER_INBOX: 'INBOX',
    FOLDER_SPAM: 'INBOX.spam',
    RSPAMD_WHITELIST_MAP_PATH: '/data/rspamd/maps/whitelist.map',
    RSPAMD_BLACKLIST_MAP_PATH: '/data/rspamd/maps/blacklist.map',
    STATE_KEY_WHITELIST_MAP: 'rspamd-whitelist-map',
    STATE_KEY_BLACKLIST_MAP: 'rspamd-blacklist-map',
  },
  error: vi.fn(),
}));

vi.mock('../src/lib/utils/config.js', () => ({
  config: mockConfig,
}));

vi.mock('../src/lib/utils/logger.js', () => ({
  rootLogger: {
    forComponent: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error,
    }),
  },
}));

vi.mock('../src/lib/state-manager.js', () => ({
  writeMapState: vi.fn(),
}));

vi.mock('../src/lib/clients/imap-client.js', () => ({
  open: vi.fn(),
  count: vi.fn(),
  fetchAllMessages: vi.fn(),
  moveMessages: vi.fn(),
}));

vi.mock('../src/lib/services/map-service.js', () => ({
  extractSenderAddresses: vi.fn(),
  updateMapFile: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  default: {
    readFile: vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('not found'), { code: 'ENOENT' })
      ),
  },
}));

import { runWhitelist } from '../src/lib/workflows/map-workflow.js';
import {
  open,
  count,
  fetchAllMessages,
  moveMessages,
} from '../src/lib/clients/imap-client.js';
import {
  extractSenderAddresses,
  updateMapFile,
} from '../src/lib/services/map-service.js';

const mockImap = {};

function makeMessage(uid) {
  return { uid };
}

describe('map-workflow: messages with no extractable sender are still moved on (5.1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    open.mockResolvedValue({});
  });

  test('no messages in folder: nothing is fetched or moved', async () => {
    count.mockReturnValue(0);

    await runWhitelist(mockImap);

    expect(fetchAllMessages).not.toHaveBeenCalled();
    expect(moveMessages).not.toHaveBeenCalled();
  });

  test('no extractable senders: messages are still moved on, map is left untouched', async () => {
    const messages = [makeMessage(1), makeMessage(2)];
    count.mockReturnValue(2);
    fetchAllMessages.mockResolvedValue(messages);
    extractSenderAddresses.mockReturnValue([]);

    await runWhitelist(mockImap);

    expect(updateMapFile).not.toHaveBeenCalled();
    expect(moveMessages).toHaveBeenCalledWith(
      mockImap,
      messages,
      mockConfig.FOLDER_INBOX
    );
  });

  test('extractable senders: map is updated and messages are moved on', async () => {
    const messages = [makeMessage(1)];
    count.mockReturnValue(1);
    fetchAllMessages.mockResolvedValue(messages);
    extractSenderAddresses.mockReturnValue(['sender@example.com']);
    updateMapFile.mockResolvedValue({ addedCount: 1, skippedCount: 0 });

    await runWhitelist(mockImap);

    expect(updateMapFile).toHaveBeenCalled();
    expect(moveMessages).toHaveBeenCalledWith(
      mockImap,
      messages,
      mockConfig.FOLDER_INBOX
    );
  });
});
