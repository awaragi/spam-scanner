import { describe, test, expect } from 'vitest';
import { defaultMailboxSettings } from './mailbox-settings.defaults.js';

describe('defaultMailboxSettings', () => {
  test('has the shape a MailboxSettings consumer expects', () => {
    expect(defaultMailboxSettings).toEqual({
      folders: {
        inbox: expect.any(String),
        spam: expect.any(String),
        spamLow: expect.any(String),
        spamHigh: expect.any(String),
        trainSpam: expect.any(String),
        trainHam: expect.any(String),
        trainWhitelist: expect.any(String),
        trainBlacklist: expect.any(String),
      },
      scanRead: expect.any(Boolean),
      scanInitialState: expect.any(String),
      processingMode: expect.any(String),
      labels: {
        spamLow: expect.any(String),
        spamHigh: expect.any(String),
      },
      thresholds: {
        clean: expect.any(Number),
        low: expect.any(Number),
        confirmed: expect.any(Number),
      },
      aiEscalation: {
        toLowThreshold: expect.any(Number),
        toHighThreshold: expect.any(Number),
      },
      aiEnabled: expect.any(Boolean),
    });
  });

  // Cross-checked 1:1 against terminal/src/lib/core/config.ts's
  // foldersGroup/scanGroup/spamProcessingGroup/labelGroup/thresholdsGroup/
  // aiGroup defaults (FOLDER_STATE excluded - that's now the mailbox
  // connection info's MAILBOX_STATE_FOLDER, not a per-mailbox setting).
  test('folder defaults match terminal FOLDER_* defaults', () => {
    expect(defaultMailboxSettings.folders).toEqual({
      inbox: 'INBOX',
      spam: 'INBOX.spam',
      spamLow: 'INBOX.spam.low',
      spamHigh: 'INBOX.spam.high',
      trainSpam: 'INBOX.scanner.train.spam',
      trainHam: 'INBOX.scanner.train.ham',
      trainWhitelist: 'INBOX.scanner.train.whitelist',
      trainBlacklist: 'INBOX.scanner.train.blacklist',
    });
  });

  test('scanRead matches terminal SCAN_READ default (false)', () => {
    expect(defaultMailboxSettings.scanRead).toBe(false);
  });

  test('scanInitialState matches terminal SCAN_INITIAL_STATE default ("new")', () => {
    expect(defaultMailboxSettings.scanInitialState).toBe('new');
  });

  test('processingMode matches terminal SPAM_PROCESSING_MODE default ("folder")', () => {
    expect(defaultMailboxSettings.processingMode).toBe('folder');
  });

  test('labels match terminal LABEL_SPAM_LOW/LABEL_SPAM_HIGH defaults', () => {
    expect(defaultMailboxSettings.labels).toEqual({
      spamLow: 'Spam:Low',
      spamHigh: 'Spam:High',
    });
  });

  test('thresholds match terminal SPAM_CLEAN/LOW/CONFIRMED_THRESHOLD defaults', () => {
    expect(defaultMailboxSettings.thresholds).toEqual({
      clean: 30,
      low: 60,
      confirmed: 200,
    });
  });

  test('aiEscalation matches terminal AI_ESCALATE_TO_LOW/HIGH_THRESHOLD defaults', () => {
    expect(defaultMailboxSettings.aiEscalation).toEqual({
      toLowThreshold: 50,
      toHighThreshold: 80,
    });
  });

  test('aiEnabled defaults to true (opt-out, not opt-in like the app-wide AI_ENABLED)', () => {
    expect(defaultMailboxSettings.aiEnabled).toBe(true);
  });

  test('aiEscalation.toLowThreshold does not exceed toHighThreshold', () => {
    expect(defaultMailboxSettings.aiEscalation.toLowThreshold).toBeLessThanOrEqual(
      defaultMailboxSettings.aiEscalation.toHighThreshold
    );
  });
});
