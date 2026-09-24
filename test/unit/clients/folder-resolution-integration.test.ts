import { describe, test, expect, vi, beforeEach } from 'vitest';

// Integration-style test: exercises the REAL folder-resolver.js, mailboxes-utils.js,
// imap-client.js and init-workflow.js together against a fake slash-delimited IMAP
// server, to confirm folder path resolution actually reaches IMAP operations
// correctly end-to-end (not just that resolveFolders() mutates config correctly
// in isolation). Before this feature existed, createAppFolders correctly
// translated the delimiter but open/moveMessages/appendMessage used the raw
// dot-joined config string regardless of the server's real delimiter - this
// test would have failed against that code (mailboxOpen/messageMove would have
// received "INBOX.scanner.train.spam" instead of "INBOX/scanner/train/spam").

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {},
}));

vi.mock('../../../src/lib/core/config.ts', () => ({
  config: mockConfig,
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

import { resolveFolders } from '../../../src/lib/clients/folder-resolver.client.ts';
import { runInit } from '../../../src/lib/controllers/workflows/init.controller.ts';
import { open, moveMessages } from '../../../src/lib/clients/imap.client.ts';

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
    SPAM_PROCESSING_MODE: 'label',
  });
}

function makeSlashDelimitedFakeImap() {
  return {
    usable: true,
    mailbox: { path: 'INBOX' },
    list: vi.fn().mockResolvedValue([{ path: 'INBOX', delimiter: '/' }]),
    mailboxCreate: vi.fn().mockResolvedValue({ created: true }),
    mailboxOpen: vi.fn().mockResolvedValue({ exists: 0 }),
    messageMove: vi.fn().mockResolvedValue(true),
  };
}

describe('folder resolution, end-to-end against a slash-delimited server', () => {
  beforeEach(() => {
    resetMockConfig();
  });

  test('runInit mutates config to the server real slash delimiter, not the configured dot form', async () => {
    const imap = makeSlashDelimitedFakeImap();

    await runInit(imap);

    const createdPaths = imap.mailboxCreate.mock.calls.map(call => call[0]);
    expect(createdPaths).toContain('INBOX/scanner/train/spam');
    expect(createdPaths).toContain('INBOX/scanner/train/whitelist');
    expect(createdPaths).not.toContain('INBOX.scanner.train.spam');
    expect(mockConfig.FOLDER_TRAIN_SPAM).toBe('INBOX/scanner/train/spam');
  });

  test('open() and moveMessages() use the resolved slash-joined config value after resolution', async () => {
    const imap = makeSlashDelimitedFakeImap();
    await resolveFolders(imap);

    await open(imap, mockConfig.FOLDER_TRAIN_SPAM);
    expect(imap.mailboxOpen).toHaveBeenCalledWith(
      'INBOX/scanner/train/spam',
      expect.any(Object)
    );

    await moveMessages(imap, [{ uid: 1 }], mockConfig.FOLDER_SPAM);
    expect(imap.messageMove).toHaveBeenCalledWith([1], 'INBOX/spam', {
      uid: true,
    });
  });
});
