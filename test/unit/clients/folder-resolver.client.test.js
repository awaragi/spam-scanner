import { describe, test, expect, vi, beforeEach } from 'vitest';

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {},
}));

vi.mock('../../../src/lib/core/config.js', () => ({
  config: mockConfig,
}));

vi.mock('../../../src/lib/clients/imap.client.js', () => ({
  getImapDelimiter: vi.fn(),
}));

import { resolveFolders } from '../../../src/lib/clients/folder-resolver.client.js';
import { getImapDelimiter } from '../../../src/lib/clients/imap.client.js';

function resetMockConfig() {
  for (const key of Object.keys(mockConfig)) {
    delete mockConfig[key];
  }
  Object.assign(mockConfig, {
    FOLDER_INBOX: 'INBOX',
    FOLDER_SPAM: 'INBOX.spam',
    FOLDER_SPAM_LOW: 'INBOX.spam.low',
    FOLDER_SPAM_HIGH: 'INBOX.spam.high',
    FOLDER_TRAIN_SPAM: 'INBOX.scanner.train.spam',
    FOLDER_TRAIN_HAM: 'INBOX.scanner.train.ham',
    FOLDER_TRAIN_WHITELIST: 'INBOX.scanner.train.whitelist',
    FOLDER_TRAIN_BLACKLIST: 'INBOX.scanner.train.blacklist',
    FOLDER_STATE: 'scanner.state',
    // A non-folder setting to prove the prefix scan doesn't touch it.
    SPAM_PROCESSING_MODE: 'folder',
  });
}

describe('folder-resolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMockConfig();
  });

  test('dot-delimited server: FOLDER_* values are left unchanged in config', async () => {
    getImapDelimiter.mockResolvedValue('.');

    await resolveFolders({});

    expect(mockConfig.FOLDER_TRAIN_SPAM).toBe('INBOX.scanner.train.spam');
    expect(mockConfig.FOLDER_INBOX).toBe('INBOX');
    expect(mockConfig.FOLDER_STATE).toBe('scanner.state');
  });

  test('slash-delimited server: dot-joined FOLDER_* config values are mutated to slashes', async () => {
    getImapDelimiter.mockResolvedValue('/');

    await resolveFolders({});

    expect(mockConfig.FOLDER_TRAIN_SPAM).toBe('INBOX/scanner/train/spam');
    expect(mockConfig.FOLDER_SPAM_LOW).toBe('INBOX/spam/low');
  });

  test('non-FOLDER_ config values are left untouched', async () => {
    getImapDelimiter.mockResolvedValue('/');

    await resolveFolders({});

    expect(mockConfig.SPAM_PROCESSING_MODE).toBe('folder');
  });

  test('a non-string FOLDER_-prefixed value is skipped rather than crashing', async () => {
    getImapDelimiter.mockResolvedValue('/');
    mockConfig.FOLDER_CREATE_MISSING = true;

    await expect(resolveFolders({})).resolves.toBeUndefined();
    expect(mockConfig.FOLDER_CREATE_MISSING).toBe(true);
  });

  test('no delimiter discoverable: resolveFolders throws, config is untouched', async () => {
    getImapDelimiter.mockResolvedValue(null);

    await expect(resolveFolders({})).rejects.toThrow(
      /could not determine IMAP server delimiter/
    );
    expect(mockConfig.FOLDER_TRAIN_SPAM).toBe('INBOX.scanner.train.spam');
  });

  test('calling resolveFolders twice is idempotent (splitFolderParts treats . / \\ uniformly)', async () => {
    getImapDelimiter.mockResolvedValue('/');

    await resolveFolders({});
    const afterFirst = mockConfig.FOLDER_TRAIN_SPAM;
    await resolveFolders({});
    const afterSecond = mockConfig.FOLDER_TRAIN_SPAM;

    expect(afterFirst).toBe('INBOX/scanner/train/spam');
    expect(afterSecond).toBe('INBOX/scanner/train/spam');
  });
});
