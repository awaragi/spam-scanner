import { describe, test, expect } from 'vitest';
import { Writable } from 'stream';
import pino from 'pino';
import type { ImapFlow } from 'imapflow';
import { createMailboxSession } from './mailbox-session.js';
import type { Mailbox } from '../infrastructure/mailboxes/mailbox.js';
import type { MailboxFolders } from '../infrastructure/imap/folder.resolver.js';
import { defaultMailboxSettings } from '../config/mailbox-settings.defaults.js';

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

/**
 * Builds a real pino logger writing to a captured stream, the same technique
 * `logging.module.spec.ts` uses - pino writes to its destination fd directly
 * (bypassing `process.stdout.write`), so a mock logger can't observe
 * `.child()` binding behavior the way a real one, captured, can.
 */
function captureLines(): { logger: pino.Logger; lines: () => Record<string, unknown>[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return {
    logger: pino({ base: null }, stream),
    lines: () =>
      chunks
        .join('')
        .split('\n')
        .filter(line => line.length > 0)
        .map(line => JSON.parse(line)),
  };
}

describe('createMailboxSession', () => {
  test('wires every field from its parts, accessible on the resulting session', () => {
    const mailbox = fixtureMailbox();
    const imap = fixtureImap();
    const folders = fixtureFolders();
    const { logger } = captureLines();

    const session = createMailboxSession({
      mailbox,
      imap,
      settings: defaultMailboxSettings,
      folders,
      logger,
    });

    expect(session.mailbox).toBe(mailbox);
    expect(session.imap).toBe(imap);
    expect(session.settings).toBe(defaultMailboxSettings);
    expect(session.folders).toBe(folders);
  });

  test('the session logger is bound to this mailbox\'s id, per D4', () => {
    const mailbox = fixtureMailbox({ id: 'jane.doe@example.com' });
    const { logger, lines } = captureLines();

    const session = createMailboxSession({
      mailbox,
      imap: fixtureImap(),
      settings: defaultMailboxSettings,
      folders: fixtureFolders(),
      logger,
    });

    expect(session.logger.bindings()).toMatchObject({
      mailboxId: 'jane.doe@example.com',
    });

    session.logger.info('scan started');

    const [line] = lines();
    expect(line).toMatchObject({
      mailboxId: 'jane.doe@example.com',
      msg: 'scan started',
    });
  });

  test('two sessions built from the same base logger carry independent bindings', () => {
    const { logger, lines } = captureLines();

    const sessionA = createMailboxSession({
      mailbox: fixtureMailbox({ id: 'a@example.com' }),
      imap: fixtureImap(),
      settings: defaultMailboxSettings,
      folders: fixtureFolders(),
      logger,
    });
    const sessionB = createMailboxSession({
      mailbox: fixtureMailbox({ id: 'b@example.com' }),
      imap: fixtureImap(),
      settings: defaultMailboxSettings,
      folders: fixtureFolders(),
      logger,
    });

    sessionA.logger.info('from a');
    sessionB.logger.info('from b');

    const [lineA, lineB] = lines();
    expect(lineA).toMatchObject({ mailboxId: 'a@example.com', msg: 'from a' });
    expect(lineB).toMatchObject({ mailboxId: 'b@example.com', msg: 'from b' });
  });

  test('throws rather than building a session for a mailbox with no id', () => {
    const { logger } = captureLines();

    expect(() =>
      createMailboxSession({
        mailbox: fixtureMailbox({ id: '' }),
        imap: fixtureImap(),
        settings: defaultMailboxSettings,
        folders: fixtureFolders(),
        logger,
      })
    ).toThrow(/no id/);
  });

  test('throws rather than building a session around a non-usable (unconnected) IMAP connection', () => {
    const { logger } = captureLines();

    expect(() =>
      createMailboxSession({
        mailbox: fixtureMailbox(),
        imap: fixtureImap({ usable: false }),
        settings: defaultMailboxSettings,
        folders: fixtureFolders(),
        logger,
      })
    ).toThrow(/not usable/);
  });
});
