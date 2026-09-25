import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { ImapFlow } from 'imapflow';
import type { Mailbox } from '../../infrastructure/mailboxes/mailbox.js';
import type { MailboxFolders } from '../../infrastructure/imap/folder.resolver.js';
import {
  defaultMailboxSettings,
  type MailboxSettings,
} from '../../config/mailbox-settings.defaults.js';
import type { MailboxSession } from '../mailbox-session.js';

vi.mock('../../infrastructure/imap/mailbox.gateway.js', () => ({
  createAppFolders: vi.fn(),
}));

import { FolderInitService } from './folder-init.service.js';
import { createAppFolders } from '../../infrastructure/imap/mailbox.gateway.js';

const mockedCreateAppFolders = vi.mocked(createAppFolders);

function fixtureMailbox(overrides: Partial<Mailbox> = {}): Mailbox {
  return {
    id: 'owner@example.com',
    imapHost: 'imap.example.com',
    imapPort: 993,
    imapUser: 'owner@example.com',
    imapPassword: 'secret',
    imapTls: true,
    imapAllowInsecure: false,
    stateFolder: 'INBOX.scanner.state',
    ...overrides,
  };
}

function fixtureFolders(overrides: Partial<MailboxFolders> = {}): MailboxFolders {
  return {
    inbox: 'INBOX',
    spam: 'INBOX.spam',
    spamLow: 'INBOX.spam.low',
    spamHigh: 'INBOX.spam.high',
    trainSpam: 'INBOX.scanner.train.spam',
    trainHam: 'INBOX.scanner.train.ham',
    trainWhitelist: 'INBOX.scanner.train.whitelist',
    trainBlacklist: 'INBOX.scanner.train.blacklist',
    state: 'INBOX.scanner.state',
    ...overrides,
  };
}

function fixtureImap(overrides: Partial<ImapFlow> = {}): ImapFlow {
  return { usable: true, ...overrides } as unknown as ImapFlow;
}

function fixtureLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  } as unknown as MailboxSession['logger'];
}

function fixtureSession(overrides: {
  folders?: Partial<MailboxFolders>;
  settings?: Partial<MailboxSettings>;
  imap?: ImapFlow;
} = {}): MailboxSession {
  return {
    mailbox: fixtureMailbox(),
    imap: overrides.imap ?? fixtureImap(),
    settings: { ...defaultMailboxSettings, ...overrides.settings },
    folders: fixtureFolders(overrides.folders),
    logger: fixtureLogger(),
  };
}

describe('FolderInitService', () => {
  let service: FolderInitService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new FolderInitService();
  });

  test('createAppFolders is called with the session imap connection and session.folders values', async () => {
    const session = fixtureSession({
      folders: {
        trainSpam: 'INBOX/scanner/train/spam',
        trainHam: 'INBOX/scanner/train/ham',
        trainWhitelist: 'INBOX/scanner/train/whitelist',
        trainBlacklist: 'INBOX/scanner/train/blacklist',
        state: 'scanner.state',
        spam: 'INBOX/spam',
      },
      settings: { processingMode: 'label' },
    });

    await service.initFolders(session);

    expect(mockedCreateAppFolders).toHaveBeenCalledWith(
      session.imap,
      [
        'INBOX/scanner/train/spam',
        'INBOX/scanner/train/ham',
        'INBOX/scanner/train/whitelist',
        'INBOX/scanner/train/blacklist',
        'scanner.state',
        'INBOX/spam',
      ],
      session.logger
    );
  });

  test('folder mode includes the spam likelihood folders from session.folders', async () => {
    const session = fixtureSession({
      settings: { processingMode: 'folder' },
      folders: { spamLow: 'spam.low', spamHigh: 'spam.high' },
    });

    await service.initFolders(session);

    const folders = mockedCreateAppFolders.mock.calls[0][1];
    expect(folders).toContain('spam.low');
    expect(folders).toContain('spam.high');
  });

  test('label mode excludes the spam likelihood folders', async () => {
    const session = fixtureSession({
      settings: { processingMode: 'label' },
      folders: { spamLow: 'spam.low', spamHigh: 'spam.high' },
    });

    await service.initFolders(session);

    const folders = mockedCreateAppFolders.mock.calls[0][1];
    expect(folders).not.toContain('spam.low');
    expect(folders).not.toContain('spam.high');
  });

  test('folder mode logs that spam likelihood folders are included', async () => {
    const session = fixtureSession({ settings: { processingMode: 'folder' } });

    await service.initFolders(session);

    expect(session.logger.debug).toHaveBeenCalledWith(
      'Processing mode is folder, including spam likelihood folders'
    );
  });

  test('label mode does not log the spam-likelihood-folders message', async () => {
    const session = fixtureSession({ settings: { processingMode: 'label' } });

    await service.initFolders(session);

    expect(session.logger.debug).not.toHaveBeenCalledWith(
      'Processing mode is folder, including spam likelihood folders'
    );
  });

  test('the spam folder is always included, regardless of processingMode', async () => {
    const labelSession = fixtureSession({
      settings: { processingMode: 'label' },
      folders: { spam: 'INBOX.spam' },
    });
    await service.initFolders(labelSession);
    expect(mockedCreateAppFolders.mock.calls[0][1]).toContain('INBOX.spam');

    vi.clearAllMocks();

    const folderSession = fixtureSession({
      settings: { processingMode: 'folder' },
      folders: { spam: 'INBOX.spam' },
    });
    await service.initFolders(folderSession);
    expect(mockedCreateAppFolders.mock.calls[0][1]).toContain('INBOX.spam');
  });

  test('logs completion after folders are created', async () => {
    const session = fixtureSession();

    await service.initFolders(session);

    expect(session.logger.debug).toHaveBeenCalledWith(
      'Folder initialization completed'
    );
  });
});
