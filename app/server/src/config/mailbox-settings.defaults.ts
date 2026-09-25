/**
 * Per-mailbox behavioral settings, with today's code defaults - see the
 * `server/configuration` spec's "Per-mailbox settings default from code"
 * requirement and design.md D5. Unlike `app-config.schema.ts`, none of this
 * is read from the environment: until a mailbox has a stored override (see
 * `4-mailbox-settings-email`), every mailbox runs on exactly these values.
 * camelCase throughout, since these are no longer env vars.
 *
 * Values are ported 1:1 from `terminal/src/lib/core/config.ts`'s
 * `foldersGroup`, `scanGroup`, `spamProcessingGroup`, `labelGroup`,
 * `thresholdsGroup` and `aiGroup` defaults - cross-check any change against
 * that file until `terminal/` is retired.
 */

/** The IMAP folder names a mailbox is organized into (see `folder-resolution`). */
export interface MailboxFolderSettings {
  inbox: string;
  spam: string;
  spamLow: string;
  spamHigh: string;
  trainSpam: string;
  trainHam: string;
  trainWhitelist: string;
  trainBlacklist: string;
}

/** IMAP keyword labels applied in `processingMode: 'label'` (see `spamProcessingGroup`). */
export interface MailboxLabelSettings {
  spamLow: string;
  spamHigh: string;
}

/**
 * Score-percentage boundaries deciding a message's tier - clean, low, high,
 * or confirmed (see `thresholdsGroup` in `terminal/src/lib/core/config.ts`).
 */
export interface MailboxThresholdSettings {
  clean: number;
  low: number;
  confirmed: number;
}

/**
 * AI escalation thresholds (0-100 AI spam score) - a message can only move to
 * a MORE severe bucket than rspamd assigned (see `aiGroup`'s
 * `AI_ESCALATE_TO_LOW_THRESHOLD`/`AI_ESCALATE_TO_HIGH_THRESHOLD`).
 */
export interface MailboxAiEscalationSettings {
  toLowThreshold: number;
  toHighThreshold: number;
}

export interface MailboxSettings {
  folders: MailboxFolderSettings;
  /** SCAN_READ: when false, only unseen (\Seen-unset) messages are scanned. */
  scanRead: boolean;
  /** SCAN_INITIAL_STATE: what a mailbox with no saved state scans first. */
  scanInitialState: 'new' | 'all';
  /** SPAM_PROCESSING_MODE: move to spam-likelihood folders, or label in place. */
  processingMode: 'label' | 'folder';
  labels: MailboxLabelSettings;
  thresholds: MailboxThresholdSettings;
  aiEscalation: MailboxAiEscalationSettings;
  /**
   * The per-mailbox AI opt-out - default `true` ("use AI if the app-wide
   * `AI_ENABLED` setting allows it"), distinct from the app-wide `AI_ENABLED`
   * flag in `app-config.schema.ts`, which defaults to `false`.
   */
  aiEnabled: boolean;
}

export const defaultMailboxSettings: MailboxSettings = {
  folders: {
    inbox: 'INBOX',
    spam: 'INBOX.spam',
    spamLow: 'INBOX.spam.low',
    spamHigh: 'INBOX.spam.high',
    trainSpam: 'INBOX.scanner.train.spam',
    trainHam: 'INBOX.scanner.train.ham',
    trainWhitelist: 'INBOX.scanner.train.whitelist',
    trainBlacklist: 'INBOX.scanner.train.blacklist',
  },
  scanRead: false,
  scanInitialState: 'new',
  processingMode: 'folder',
  labels: {
    spamLow: 'Spam:Low',
    spamHigh: 'Spam:High',
  },
  thresholds: {
    clean: 30,
    low: 60,
    confirmed: 200,
  },
  aiEscalation: {
    toLowThreshold: 50,
    toHighThreshold: 80,
  },
  aiEnabled: true,
};
