import { describe, test, expect, vi, beforeEach } from 'vitest';
import { fixtureContext } from '../../../support/fixtures.ts';
import { asImapFlow } from '../../../support/imap-fakes.ts';

vi.mock('../../../../src/lib/clients/imap.client.ts', () => ({
  createAppFolders: vi.fn(),
}));

vi.mock('../../../../src/lib/clients/folder-resolver.client.ts', () => ({
  resolveFolders: vi.fn(),
}));

import { runInit } from '../../../../src/lib/controllers/workflows/init.controller.ts';
import { createAppFolders } from '../../../../src/lib/clients/imap.client.ts';
import { resolveFolders } from '../../../../src/lib/clients/folder-resolver.client.ts';

const mockedCreateAppFolders = vi.mocked(createAppFolders);
const mockedResolveFolders = vi.mocked(resolveFolders);
const mockImap = asImapFlow({});

describe('runInit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedResolveFolders.mockResolvedValue(undefined);
  });

  test('resolveFolders runs before createAppFolders', async () => {
    const callOrder: string[] = [];
    mockedResolveFolders.mockImplementation(async () => {
      callOrder.push('resolveFolders');
    });
    mockedCreateAppFolders.mockImplementation(async () => {
      callOrder.push('createAppFolders');
    });

    await runInit(mockImap, fixtureContext());

    expect(callOrder).toEqual(['resolveFolders', 'createAppFolders']);
    expect(mockedResolveFolders).toHaveBeenCalledWith(mockImap);
  });

  test('createAppFolders is called with ctx.config.FOLDER_* values', async () => {
    const ctx = fixtureContext({
      config: {
        FOLDER_TRAIN_SPAM: 'INBOX/scanner/train/spam',
        FOLDER_TRAIN_HAM: 'INBOX/scanner/train/ham',
        FOLDER_TRAIN_WHITELIST: 'INBOX/scanner/train/whitelist',
        FOLDER_TRAIN_BLACKLIST: 'INBOX/scanner/train/blacklist',
        FOLDER_STATE: 'scanner.state',
        FOLDER_SPAM: 'INBOX/spam',
        SPAM_PROCESSING_MODE: 'label',
      },
    });

    await runInit(mockImap, ctx);

    expect(mockedCreateAppFolders).toHaveBeenCalledWith(mockImap, [
      'INBOX/scanner/train/spam',
      'INBOX/scanner/train/ham',
      'INBOX/scanner/train/whitelist',
      'INBOX/scanner/train/blacklist',
      'scanner.state',
      'INBOX/spam',
    ]);
  });

  test('folder mode includes the spam likelihood folders from config', async () => {
    const ctx = fixtureContext({
      config: {
        SPAM_PROCESSING_MODE: 'folder',
        FOLDER_SPAM_LOW: 'spam.low',
        FOLDER_SPAM_HIGH: 'spam.high',
      },
    });

    await runInit(mockImap, ctx);

    const folders = mockedCreateAppFolders.mock.calls[0][1];
    expect(folders).toContain('spam.low');
    expect(folders).toContain('spam.high');
  });

  test('FOLDER_SPAM is always created, regardless of SPAM_PROCESSING_MODE', async () => {
    const labelCtx = fixtureContext({
      config: { SPAM_PROCESSING_MODE: 'label', FOLDER_SPAM: 'INBOX.spam' },
    });
    await runInit(mockImap, labelCtx);
    expect(mockedCreateAppFolders.mock.calls[0][1]).toContain('INBOX.spam');

    vi.clearAllMocks();
    mockedResolveFolders.mockResolvedValue();

    const folderCtx = fixtureContext({
      config: { SPAM_PROCESSING_MODE: 'folder', FOLDER_SPAM: 'INBOX.spam' },
    });
    await runInit(mockImap, folderCtx);
    expect(mockedCreateAppFolders.mock.calls[0][1]).toContain('INBOX.spam');
  });
});
