import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { ImapFlow } from 'imapflow';
import type { Logger as PinoLogger } from 'pino';
import { defaultMailboxSettings } from '../../config/mailbox-settings.defaults.js';
import type { Mailbox } from '../../infrastructure/mailboxes/mailbox.js';
import type { MailboxFolders } from '../../infrastructure/imap/folder.resolver.js';
import type { MailboxSession } from '../mailbox-session.js';

const { mockUpdateLabels, mockMoveMessages } = vi.hoisted(() => ({
  mockUpdateLabels: vi.fn().mockResolvedValue(undefined),
  mockMoveMessages: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../infrastructure/imap/mailbox.gateway.js', () => ({
  updateLabels: mockUpdateLabels,
  moveMessages: mockMoveMessages,
}));

const { DispositionStep } = await import('./disposition.step.js');

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

function fixtureFolders(
  overrides: Partial<MailboxFolders> = {}
): MailboxFolders {
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

function fixtureLogger(): PinoLogger {
  const logger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: () => logger,
  };
  return logger as unknown as PinoLogger;
}

function fixtureSession(
  overrides: Partial<MailboxSession> = {}
): MailboxSession {
  return {
    mailbox: fixtureMailbox(),
    imap: {} as ImapFlow,
    settings: defaultMailboxSettings,
    folders: fixtureFolders(),
    logger: fixtureLogger(),
    ...overrides,
  };
}

describe('DispositionStep', () => {
  const step = new DispositionStep();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('applyLabels', () => {
    test('resets spam labels on non-spam messages', async () => {
      const session = fixtureSession({
        settings: {
          ...defaultMailboxSettings,
          labels: { spamLow: 'Spam:Low', spamHigh: 'Spam:High' },
        },
      });
      const nonSpamMessages = [{ uid: 1 }];

      await step.applyLabels(
        { nonSpamMessages, lowSpamMessages: [], highSpamMessages: [] },
        session
      );

      expect(mockUpdateLabels).toHaveBeenCalledWith(
        session.imap,
        nonSpamMessages,
        [],
        ['Spam:Low', 'Spam:High'],
        session.logger
      );
    });

    test('applies Spam:Low to low-spam messages, unsetting Spam:High', async () => {
      const session = fixtureSession({
        settings: {
          ...defaultMailboxSettings,
          labels: { spamLow: 'Spam:Low', spamHigh: 'Spam:High' },
        },
      });
      const lowSpamMessages = [{ uid: 2 }];

      await step.applyLabels(
        { nonSpamMessages: [], lowSpamMessages, highSpamMessages: [] },
        session
      );

      expect(mockUpdateLabels).toHaveBeenCalledWith(
        session.imap,
        lowSpamMessages,
        ['Spam:Low'],
        ['Spam:High'],
        session.logger
      );
    });

    test('applies Spam:High to high-spam messages, unsetting Spam:Low', async () => {
      const session = fixtureSession({
        settings: {
          ...defaultMailboxSettings,
          labels: { spamLow: 'Spam:Low', spamHigh: 'Spam:High' },
        },
      });
      const highSpamMessages = [{ uid: 3 }];

      await step.applyLabels(
        { nonSpamMessages: [], lowSpamMessages: [], highSpamMessages },
        session
      );

      expect(mockUpdateLabels).toHaveBeenCalledWith(
        session.imap,
        highSpamMessages,
        ['Spam:High'],
        ['Spam:Low'],
        session.logger
      );
    });

    test('reads label names fresh from session.settings on every call - no module-load-time capture', async () => {
      const first = fixtureSession({
        settings: {
          ...defaultMailboxSettings,
          labels: { spamLow: 'First:Low', spamHigh: 'First:High' },
        },
      });
      await step.applyLabels(
        {
          nonSpamMessages: [],
          lowSpamMessages: [{ uid: 1 }],
          highSpamMessages: [],
        },
        first
      );
      expect(mockUpdateLabels).toHaveBeenCalledWith(
        first.imap,
        [{ uid: 1 }],
        ['First:Low'],
        ['First:High'],
        first.logger
      );

      vi.clearAllMocks();

      const second = fixtureSession({
        settings: {
          ...defaultMailboxSettings,
          labels: { spamLow: 'Second:Low', spamHigh: 'Second:High' },
        },
      });
      await step.applyLabels(
        {
          nonSpamMessages: [],
          lowSpamMessages: [{ uid: 1 }],
          highSpamMessages: [],
        },
        second
      );
      expect(mockUpdateLabels).toHaveBeenCalledWith(
        second.imap,
        [{ uid: 1 }],
        ['Second:Low'],
        ['Second:High'],
        second.logger
      );
    });
  });

  describe('moveToFolders', () => {
    test('moves low-spam messages to folders.spamLow and high-spam to folders.spamHigh', async () => {
      const session = fixtureSession({
        folders: fixtureFolders({ spamLow: 'spam.low', spamHigh: 'spam.high' }),
      });
      const lowSpamMessages = [{ uid: 1 }];
      const highSpamMessages = [{ uid: 2 }];

      await step.moveToFolders(
        { nonSpamMessages: [], lowSpamMessages, highSpamMessages },
        session
      );

      expect(mockMoveMessages).toHaveBeenCalledWith(
        session.imap,
        lowSpamMessages,
        'spam.low',
        session.logger
      );
      expect(mockMoveMessages).toHaveBeenCalledWith(
        session.imap,
        highSpamMessages,
        'spam.high',
        session.logger
      );
    });

    test('throws when folders.spamLow is not configured', async () => {
      const session = fixtureSession({
        folders: fixtureFolders({ spamLow: '', spamHigh: 'spam.high' }),
      });

      await expect(
        step.moveToFolders(
          { nonSpamMessages: [], lowSpamMessages: [], highSpamMessages: [] },
          session
        )
      ).rejects.toThrow('FOLDER_SPAM_LOW');
    });

    test('throws when folders.spamHigh is not configured', async () => {
      const session = fixtureSession({
        folders: fixtureFolders({ spamLow: 'spam.low', spamHigh: '' }),
      });

      await expect(
        step.moveToFolders(
          { nonSpamMessages: [], lowSpamMessages: [], highSpamMessages: [] },
          session
        )
      ).rejects.toThrow('FOLDER_SPAM_HIGH');
    });
  });

  describe('moveConfirmedSpam', () => {
    test('moves the given messages to folders.spam', async () => {
      const session = fixtureSession({
        folders: fixtureFolders({ spam: 'INBOX.spam' }),
      });
      const spamMessages = [{ uid: 1 }, { uid: 2 }];

      await step.moveConfirmedSpam(spamMessages, session);

      expect(mockMoveMessages).toHaveBeenCalledWith(
        session.imap,
        spamMessages,
        'INBOX.spam',
        session.logger
      );
    });

    test('an empty list still calls through (moveMessages owns the no-op case)', async () => {
      const session = fixtureSession();

      await step.moveConfirmedSpam([], session);

      expect(mockMoveMessages).toHaveBeenCalledWith(
        session.imap,
        [],
        session.folders.spam,
        session.logger
      );
    });
  });
});
