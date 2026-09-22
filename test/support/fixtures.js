import { AiFailureTracker } from '../../src/lib/services/ai-failure-tracker.service.js';

export function fixtureMessage({ from, envelope, ...overrides } = {}) {
  const sender = from ?? 'sender@example.com';
  return {
    uid: 1,
    envelope: {
      date: new Date(),
      subject: '',
      from: [{ address: sender }],
      ...envelope,
    },
    headers: { from: sender },
    raw: `From: ${sender}\r\n\r\nBody`,
    body: 'Body',
    ...overrides,
  };
}

/**
 * A rspamd `/checkv2` response fixture. `authenticated: true` adds the
 * `R_DKIM_ALLOW` symbol, so `parseRspamdOutput` reports
 * `senderAuthenticated: true` - the signal `applyWhitelistAdjustment`/
 * `partitionByWhitelistFlag` gate the full whitelist discount and AI-skip
 * on (see the `sender-lists` capability).
 */
export function fixtureRspamdCheck({
  score = 5,
  required = 15,
  authenticated = false,
} = {}) {
  return {
    score,
    required_score: required,
    ...(authenticated ? { symbols: { R_DKIM_ALLOW: { score: -0.2 } } } : {}),
  };
}

export function fixtureAiResult({ score = 10, reasoning = 'looks fine' } = {}) {
  return { score, reasoning };
}

/**
 * A ctx literal covering every config field a controller currently reads.
 * Callers spread over `config` to override specific values - never needs
 * vi.mock(). Defaults are chosen for test-example clarity, NOT to mirror
 * config.js's real env-var defaults (see note below) - override anything
 * a specific test depends on rather than assuming these match production.
 */
export function fixtureContext(overrides = {}) {
  const { config: configOverrides, ...rest } = overrides;
  return {
    config: {
      FOLDER_INBOX: 'INBOX',
      FOLDER_SPAM: 'INBOX.spam',
      FOLDER_SPAM_LOW: 'INBOX.spam.low',
      FOLDER_SPAM_HIGH: 'INBOX.spam.high',
      FOLDER_TRAIN_SPAM: 'INBOX.scanner.train.spam',
      FOLDER_TRAIN_HAM: 'INBOX.scanner.train.ham',
      FOLDER_TRAIN_WHITELIST: 'INBOX.scanner.train.whitelist',
      FOLDER_TRAIN_BLACKLIST: 'INBOX.scanner.train.blacklist',
      FOLDER_STATE: 'scanner.state',
      LABEL_SPAM_LOW: 'Spam:Low',
      LABEL_SPAM_HIGH: 'Spam:High',
      SCAN_READ: true,
      SCAN_BATCH_SIZE: 200,
      PROCESS_BATCH_SIZE: 10,
      STATE_KEY_BLACKLIST_MAP: 'rspamd-blacklist-map',
      STATE_KEY_WHITELIST_MAP: 'rspamd-whitelist-map',
      SPAM_CLEAN_THRESHOLD: 30,
      SPAM_LOW_THRESHOLD: 60,
      SPAM_CONFIRMED_THRESHOLD: 200,
      SPAM_PROCESSING_MODE: 'label',
      IMAP_USER: 'owner@example.com',
      IMAP_NOTIFY_ADDRESS: '',
      RSPAMD_ENVELOPE_TRUSTED_HOPS: 0,
      AI_ENABLED: false,
      AI_CONCURRENCY: 5,
      AI_MAX_INPUT_TOKENS: 6000,
      AI_FAILURE_ALERT_THRESHOLD: 3,
      AI_ESCALATE_TO_LOW_THRESHOLD: 50,
      AI_ESCALATE_TO_HIGH_THRESHOLD: 80,
      ...configOverrides,
    },
    aiFailureTracker: new AiFailureTracker(),
    ...rest,
  };
}
