import { describe, test, expect, vi, beforeEach } from 'vitest';
import { Test } from '@nestjs/testing';
import type { ImapFlow } from 'imapflow';
import type { Logger as PinoLogger } from 'pino';
import { AiClassificationStep } from './ai-classification.step.js';
import { AiGateway } from '../../infrastructure/ai/ai.gateway.js';
import { AiConfig } from '../../config/app-config.js';
import { AiFailureTracker } from '../../domain/ai/ai-failure-tracker.js';
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

function makeMessage(uid: number, envelope: Record<string, unknown> = {}) {
  return { uid, envelope, raw: `raw-${uid}` };
}

function fixtureAiConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    enabled: true,
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'test-key',
    model: 'gpt-test',
    timeoutMs: 5000,
    maxRetries: 0,
    concurrency: 5,
    maxInputTokens: 6000,
    maxOutputTokens: 200,
    failureAlertThreshold: 3,
    ...overrides,
  } as AiConfig;
}

async function buildStep(
  aiConfigOverrides: Partial<AiConfig> = {}
): Promise<{
  step: AiClassificationStep;
  fakeAiGateway: { classifyEmail: ReturnType<typeof vi.fn> };
  tracker: AiFailureTracker;
}> {
  const fakeAiGateway = { classifyEmail: vi.fn() };
  const tracker = new AiFailureTracker();

  const module = await Test.createTestingModule({
    providers: [
      AiClassificationStep,
      { provide: AiGateway, useValue: fakeAiGateway },
      { provide: AiConfig, useValue: fixtureAiConfig(aiConfigOverrides) },
      { provide: AiFailureTracker, useValue: tracker },
    ],
  }).compile();

  return { step: module.get(AiClassificationStep), fakeAiGateway, tracker };
}

describe('AiClassificationStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('returns immediately with empty arrays when there are no candidates', async () => {
    const { step, fakeAiGateway } = await buildStep();

    const result = await step.classify(
      { nonSpamMessages: [], lowSpamMessages: [] },
      fixtureSession()
    );

    expect(result).toEqual({ nonSpamMessages: [], lowSpamMessages: [] });
    expect(fakeAiGateway.classifyEmail).not.toHaveBeenCalled();
  });

  test('attaches aiInfo on success and preserves bucket split/order', async () => {
    const { step, fakeAiGateway } = await buildStep();
    fakeAiGateway.classifyEmail.mockImplementation(async content => ({
      score: 20,
      reasoning: `reason-${content.text}`,
    }));

    const nonSpamMessages = [makeMessage(1), makeMessage(2)];
    const lowSpamMessages = [makeMessage(3)];

    const result = await step.classify(
      { nonSpamMessages, lowSpamMessages },
      fixtureSession()
    );

    expect(result.nonSpamMessages).toHaveLength(2);
    expect(result.lowSpamMessages).toHaveLength(1);
    expect(result.nonSpamMessages[0]).toMatchObject({
      uid: 1,
      aiInfo: { score: 20, error: null },
    });
    expect(result.lowSpamMessages[0]).toMatchObject({
      uid: 3,
      aiInfo: { score: 20, error: null },
    });
  });

  test('fails open on a per-message error without affecting sibling messages or rethrowing', async () => {
    const { step, fakeAiGateway } = await buildStep();
    let call = 0;
    fakeAiGateway.classifyEmail.mockImplementation(async () => {
      call++;
      if (call === 2) throw new Error('provider timeout');
      return { score: 15, reasoning: 'ok' };
    });

    const nonSpamMessages = [makeMessage(1), makeMessage(2), makeMessage(3)];

    const result = await step.classify(
      { nonSpamMessages, lowSpamMessages: [] },
      fixtureSession()
    );

    const errors = result.nonSpamMessages.map(m => m.aiInfo.error);
    expect(errors.filter(Boolean)).toEqual(['provider timeout']);
    expect(errors.filter(e => e === null)).toHaveLength(2);
  });

  test('respects the injected AiConfig.concurrency', async () => {
    const { step, fakeAiGateway } = await buildStep({ concurrency: 2 });
    let inFlight = 0;
    let maxInFlight = 0;

    fakeAiGateway.classifyEmail.mockImplementation(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(resolve => setTimeout(resolve, 5));
      inFlight--;
      return { score: 1, reasoning: 'ok' };
    });

    const nonSpamMessages = [1, 2, 3, 4, 5].map(uid => makeMessage(uid));

    await step.classify(
      { nonSpamMessages, lowSpamMessages: [] },
      fixtureSession()
    );

    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  test('resolves maxInputTokens from the injected AiConfig.maxInputTokens', async () => {
    const { step, fakeAiGateway } = await buildStep({ maxInputTokens: 6000 });
    fakeAiGateway.classifyEmail.mockResolvedValue({ score: 1, reasoning: 'ok' });
    const message = {
      uid: 1,
      envelope: {},
      raw: `From: a@b.com\r\n\r\n${'x'.repeat(30000)}`,
    };

    await step.classify(
      { nonSpamMessages: [message], lowSpamMessages: [] },
      fixtureSession()
    );

    const [content] = fakeAiGateway.classifyEmail.mock.calls[0];
    // 6000 tokens * 4 chars/token = 24000 chars, plus the truncation marker.
    expect(content.text.length).toBeLessThanOrEqual(
      24000 + '…[truncated]'.length
    );
  });

  test('records a success on the shared AiFailureTracker', async () => {
    const { step, fakeAiGateway, tracker } = await buildStep();
    fakeAiGateway.classifyEmail.mockResolvedValue({ score: 1, reasoning: 'ok' });
    const recordSuccess = vi.spyOn(tracker, 'recordSuccess');

    await step.classify(
      { nonSpamMessages: [makeMessage(1)], lowSpamMessages: [] },
      fixtureSession()
    );

    expect(recordSuccess).toHaveBeenCalledTimes(1);
  });

  test('records a failure on the shared AiFailureTracker with the configured failureAlertThreshold', async () => {
    const { step, fakeAiGateway, tracker } = await buildStep({
      failureAlertThreshold: 3,
    });
    fakeAiGateway.classifyEmail.mockRejectedValue(
      new Error('provider timeout')
    );
    const recordFailure = vi.spyOn(tracker, 'recordFailure');

    await step.classify(
      { nonSpamMessages: [makeMessage(1)], lowSpamMessages: [] },
      fixtureSession()
    );

    expect(recordFailure).toHaveBeenCalledWith(expect.any(Error), 3);
  });

  test('a success resets the tracker so a later failure streak starts over (no throw, fail-open both times)', async () => {
    const { step, fakeAiGateway } = await buildStep({
      failureAlertThreshold: 2,
    });
    fakeAiGateway.classifyEmail.mockRejectedValueOnce(new Error('boom'));
    fakeAiGateway.classifyEmail.mockResolvedValueOnce({
      score: 1,
      reasoning: 'ok',
    });
    fakeAiGateway.classifyEmail.mockRejectedValueOnce(new Error('boom'));

    const session = fixtureSession();
    const first = await step.classify(
      { nonSpamMessages: [makeMessage(1)], lowSpamMessages: [] },
      session
    );
    const second = await step.classify(
      { nonSpamMessages: [makeMessage(2)], lowSpamMessages: [] },
      session
    );
    const third = await step.classify(
      { nonSpamMessages: [makeMessage(3)], lowSpamMessages: [] },
      session
    );

    expect(first.nonSpamMessages[0].aiInfo.error).toBe('boom');
    expect(second.nonSpamMessages[0].aiInfo.error).toBeNull();
    expect(third.nonSpamMessages[0].aiInfo.error).toBe('boom');
  });
});
