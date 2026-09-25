import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { ImapFlow } from 'imapflow';
import type { Logger as PinoLogger } from 'pino';
import { defaultMailboxSettings } from '../../config/mailbox-settings.defaults.js';
import type { Mailbox } from '../../infrastructure/mailboxes/mailbox.js';
import type { MailboxFolders } from '../../infrastructure/imap/folder.resolver.js';
import type { MailboxSession } from '../mailbox-session.js';

const { mockReadMapState } = vi.hoisted(() => ({
  mockReadMapState: vi.fn(),
}));

vi.mock('../../infrastructure/state/sender-list.repository.js', () => ({
  readMapState: mockReadMapState,
}));

const { SenderListLookupStep } = await import('./sender-list-lookup.step.js');

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

describe('SenderListLookupStep', () => {
  const step = new SenderListLookupStep();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('reads whitelist and blacklist by their fixed state keys, returning Sets', async () => {
    const session = fixtureSession();
    mockReadMapState.mockImplementation((imap, stateFolder, key) =>
      Promise.resolve(
        key === 'rspamd-whitelist-map'
          ? ['trusted@example.com']
          : ['bad@evil.com']
      )
    );

    const result = await step.load(session);

    expect(result.whitelistSet).toEqual(new Set(['trusted@example.com']));
    expect(result.blacklistSet).toEqual(new Set(['bad@evil.com']));
  });

  test('reads sequentially: whitelist before blacklist', async () => {
    const session = fixtureSession();
    const callOrder: string[] = [];
    mockReadMapState.mockImplementation((imap, stateFolder, key) => {
      callOrder.push(key);
      return Promise.resolve([]);
    });

    await step.load(session);

    expect(callOrder).toEqual(['rspamd-whitelist-map', 'rspamd-blacklist-map']);
  });

  test('empty state produces empty Sets', async () => {
    const session = fixtureSession();
    mockReadMapState.mockResolvedValue([]);

    const result = await step.load(session);

    expect(result.whitelistSet.size).toBe(0);
    expect(result.blacklistSet.size).toBe(0);
  });

  test('reads from session.folders.state, not the inbox', async () => {
    const session = fixtureSession({
      folders: fixtureFolders({ state: 'INBOX.custom.state' }),
    });
    mockReadMapState.mockResolvedValue([]);

    await step.load(session);

    expect(mockReadMapState).toHaveBeenCalledWith(
      session.imap,
      'INBOX.custom.state',
      'rspamd-whitelist-map',
      session.logger
    );
  });
});
