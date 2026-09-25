import { describe, test, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import type { ImapFlow } from 'imapflow';
import type { Logger as PinoLogger } from 'pino';
import { RspamdCheckStep } from './rspamd-check.step.js';
import { RspamdGateway } from '../../infrastructure/rspamd/rspamd.gateway.js';
import { RspamdConfig } from '../../config/app-config.js';
import { defaultMailboxSettings } from '../../config/mailbox-settings.defaults.js';
import type { Mailbox } from '../../infrastructure/mailboxes/mailbox.js';
import type { MailboxFolders } from '../../infrastructure/imap/folder.resolver.js';
import type { MailboxSession } from '../mailbox-session.js';

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

function makeMessage(uid: number, from?: string) {
  return {
    uid,
    envelope: {
      subject: `subject-${uid}`,
      date: new Date(),
      ...(from ? { from: [{ address: from }] } : {}),
    },
    raw: `raw-${uid}`,
  };
}

describe('RspamdCheckStep', () => {
  let step: RspamdCheckStep;
  let fakeRspamdGateway: { checkEmail: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    fakeRspamdGateway = { checkEmail: vi.fn() };

    const module = await Test.createTestingModule({
      providers: [
        RspamdCheckStep,
        { provide: RspamdGateway, useValue: fakeRspamdGateway },
        {
          provide: RspamdConfig,
          useValue: {
            url: 'http://localhost:11333',
            password: '',
            timeoutMs: 5000,
            envelopeTrustedHops: 0,
          },
        },
      ],
    }).compile();

    step = module.get(RspamdCheckStep);
  });

  test('empty input returns empty array without calling checkEmail', async () => {
    const result = await step.check([], fixtureSession());
    expect(result).toEqual([]);
    expect(fakeRspamdGateway.checkEmail).not.toHaveBeenCalled();
  });

  test('all messages succeed: returns each with spamInfo attached, unchanged shape', async () => {
    const messages = [makeMessage(1), makeMessage(2)];
    fakeRspamdGateway.checkEmail.mockResolvedValue({
      score: 1,
      required_score: 15,
    });

    const result = await step.check(messages, fixtureSession());

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      uid: 1,
      spamInfo: { score: 1, required: 15 },
    });
    expect(result[1]).toMatchObject({
      uid: 2,
      spamInfo: { score: 1, required: 15 },
    });
    expect(result[0].spamInfo).not.toHaveProperty('isWhitelisted');
  });

  test('threads senderAuthenticated from rspamd symbols onto spamInfo', async () => {
    const messages = [makeMessage(1)];
    fakeRspamdGateway.checkEmail.mockResolvedValue({
      score: 1,
      required_score: 15,
      symbols: { R_DKIM_ALLOW: { score: -0.2 } },
    });

    const result = await step.check(messages, fixtureSession());

    expect(result[0].spamInfo.senderAuthenticated).toBe(true);
  });

  test('resolves envelope data from the raw message and passes it to checkEmail', async () => {
    const raw = `Received: from mail.example.com (unknown [203.0.113.5])\n\tby mx.provider.com (Postfix) with ESMTPS id ABC123\nReturn-Path: <sender@example.com>\nSubject: subject-1\n\nBody`;
    const message = {
      uid: 1,
      envelope: { subject: 'subject-1', date: new Date() },
      raw,
    };
    fakeRspamdGateway.checkEmail.mockResolvedValue({
      score: 1,
      required_score: 15,
    });

    await step.check(
      [message],
      fixtureSession({ mailbox: fixtureMailbox({ imapUser: 'owner@example.com' }) })
    );

    expect(fakeRspamdGateway.checkEmail).toHaveBeenCalledWith(raw, {
      ip: '203.0.113.5',
      helo: 'mail.example.com',
      from: 'sender@example.com',
      rcpt: 'owner@example.com',
    });
  });

  test('omits Rcpt when the mailbox IMAP login is not an email address', async () => {
    const message = makeMessage(1);
    fakeRspamdGateway.checkEmail.mockResolvedValue({
      score: 1,
      required_score: 15,
    });

    await step.check(
      [message],
      fixtureSession({ mailbox: fixtureMailbox({ imapUser: 'pierre' }) })
    );

    expect(fakeRspamdGateway.checkEmail).toHaveBeenCalledWith(
      message.raw,
      expect.objectContaining({ rcpt: null })
    );
  });

  test('honors the injected RspamdConfig.envelopeTrustedHops to skip internal hops', async () => {
    const raw = `Received: from internal-relay.example.com (internal-relay.example.com [10.0.0.5])\n\tby store.example.com\nReceived: from sender.attacker.example (unknown [203.0.113.9])\n\tby internal-relay.example.com\nSubject: subject-1\n\nBody`;
    const message = {
      uid: 1,
      envelope: { subject: 'subject-1', date: new Date() },
      raw,
    };
    fakeRspamdGateway.checkEmail.mockResolvedValue({
      score: 1,
      required_score: 15,
    });

    const module = await Test.createTestingModule({
      providers: [
        RspamdCheckStep,
        { provide: RspamdGateway, useValue: fakeRspamdGateway },
        {
          provide: RspamdConfig,
          useValue: {
            url: 'http://localhost:11333',
            password: '',
            timeoutMs: 5000,
            envelopeTrustedHops: 1,
          },
        },
      ],
    }).compile();
    const trustedHopsStep = module.get(RspamdCheckStep);

    await trustedHopsStep.check([message], fixtureSession());

    expect(fakeRspamdGateway.checkEmail).toHaveBeenCalledWith(
      raw,
      expect.objectContaining({
        ip: '203.0.113.9',
        helo: 'sender.attacker.example',
      })
    );
  });

  test('one permanent failure, one success: permanent one skipped, success kept, no throw', async () => {
    const messages = [makeMessage(1), makeMessage(2)];
    fakeRspamdGateway.checkEmail.mockImplementation(async raw => {
      if (raw === 'raw-1') {
        const err: Error & { status?: number } = new Error('bad request');
        err.status = 400;
        throw err;
      }
      return { score: 1, required_score: 15 };
    });

    const result = await step.check(messages, fixtureSession());

    expect(result).toHaveLength(1);
    expect(result[0].uid).toBe(2);
  });

  test('one transient failure: the whole call rejects', async () => {
    const messages = [makeMessage(1)];
    fakeRspamdGateway.checkEmail.mockRejectedValue(new Error('network error'));

    await expect(step.check(messages, fixtureSession())).rejects.toThrow(
      /transiently/
    );
  });

  test('mixed permanent and transient failures: rejects', async () => {
    const messages = [makeMessage(1), makeMessage(2)];
    fakeRspamdGateway.checkEmail.mockImplementation(async raw => {
      if (raw === 'raw-1') {
        const err: Error & { status?: number } = new Error('bad request');
        err.status = 400;
        throw err;
      }
      throw new Error('network error');
    });

    await expect(step.check(messages, fixtureSession())).rejects.toThrow(
      /transiently/
    );
  });
});
