import { describe, test, expect, vi, beforeEach } from 'vitest';

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    FOLDER_TRAIN_SPAM: 'INBOX.scanner.train.spam',
    FOLDER_TRAIN_HAM: 'INBOX.scanner.train.ham',
    FOLDER_TRAIN_WHITELIST: 'INBOX.scanner.train.whitelist',
    FOLDER_TRAIN_BLACKLIST: 'INBOX.scanner.train.blacklist',
    FOLDER_STATE: 'scanner.state',
    FOLDER_SPAM_LOW: 'INBOX.spam.low',
    FOLDER_SPAM_HIGH: 'INBOX.spam.high',
    SPAM_PROCESSING_MODE: 'label',
  },
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
      error: vi.fn(),
    }),
  },
}));

vi.mock('../src/lib/clients/imap-client.js', () => ({
  createAppFolders: vi.fn(),
}));

vi.mock('../src/lib/utils/folder-resolver.js', () => ({
  resolveFolders: vi.fn(),
}));

import { runInit } from '../src/lib/workflows/init-workflow.js';
import { createAppFolders } from '../src/lib/clients/imap-client.js';
import { resolveFolders } from '../src/lib/utils/folder-resolver.js';

const mockImap = {};

describe('runInit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.SPAM_PROCESSING_MODE = 'label';
    mockConfig.FOLDER_TRAIN_SPAM = 'INBOX.scanner.train.spam';
    mockConfig.FOLDER_TRAIN_HAM = 'INBOX.scanner.train.ham';
    mockConfig.FOLDER_TRAIN_WHITELIST = 'INBOX.scanner.train.whitelist';
    mockConfig.FOLDER_TRAIN_BLACKLIST = 'INBOX.scanner.train.blacklist';
    mockConfig.FOLDER_STATE = 'scanner.state';
    mockConfig.FOLDER_SPAM_LOW = 'INBOX.spam.low';
    mockConfig.FOLDER_SPAM_HIGH = 'INBOX.spam.high';
  });

  test('resolveFolders runs before createAppFolders', async () => {
    const callOrder = [];
    resolveFolders.mockImplementation(async () => {
      callOrder.push('resolveFolders');
    });
    createAppFolders.mockImplementation(async () => {
      callOrder.push('createAppFolders');
    });

    await runInit(mockImap);

    expect(callOrder).toEqual(['resolveFolders', 'createAppFolders']);
    expect(resolveFolders).toHaveBeenCalledWith(mockImap);
  });

  test('createAppFolders is called with config.FOLDER_* values, read after resolveFolders ran', async () => {
    // Simulate resolveFolders' real effect: mutating config in place.
    resolveFolders.mockImplementation(async () => {
      mockConfig.FOLDER_TRAIN_SPAM = 'INBOX/scanner/train/spam';
      mockConfig.FOLDER_TRAIN_HAM = 'INBOX/scanner/train/ham';
      mockConfig.FOLDER_TRAIN_WHITELIST = 'INBOX/scanner/train/whitelist';
      mockConfig.FOLDER_TRAIN_BLACKLIST = 'INBOX/scanner/train/blacklist';
      mockConfig.FOLDER_STATE = 'scanner.state';
    });

    await runInit(mockImap);

    expect(createAppFolders).toHaveBeenCalledWith(mockImap, [
      'INBOX/scanner/train/spam',
      'INBOX/scanner/train/ham',
      'INBOX/scanner/train/whitelist',
      'INBOX/scanner/train/blacklist',
      'scanner.state',
    ]);
  });

  test('folder mode includes the spam likelihood folders from config', async () => {
    mockConfig.SPAM_PROCESSING_MODE = 'folder';

    await runInit(mockImap);

    const folders = createAppFolders.mock.calls[0][1];
    expect(folders).toContain('INBOX.spam.low');
    expect(folders).toContain('INBOX.spam.high');
  });
});
