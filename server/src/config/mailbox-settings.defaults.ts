/**
 * Per-mailbox behavioral settings, with today's code defaults - see the
 * `server/configuration` spec's "Per-mailbox settings default from code"
 * requirement and design.md D5. Unlike `app-config.schema.ts`, none of this
 * is read from the environment: until a mailbox has a stored override (see
 * `4-mailbox-settings-email`), every mailbox runs on exactly these values.
 * camelCase throughout, since these are no longer env vars.
 */
import type { OverridableSettings } from './mailbox-settings.schema.js';

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
 * or confirmed.
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

/**
 * Resolves a mailbox's validated settings overrides against
 * `defaultMailboxSettings` into the exact `MailboxSettings` shape every
 * consumer (`MailboxSession`, `ScanService`, both training services,
 * `FolderInitService`) already expects - see design.md D3. A one-level-deep
 * merge: each of the four nested groups is object-spread over its own
 * default group (an override to one field in a group leaves every other
 * field in that same group at its default); top-level scalars fall back to
 * the default only when `undefined`.
 *
 * `aiEnabled` is a separate parameter, not part of `overrides` -
 * `persistent-mailbox-accounts` design.md D5 moved it off the IMAP
 * settings-override path entirely: it is resolved from the mailbox's
 * account record (`Mailbox.aiEnabled`), admin-only, never from a settings
 * message. Defaults to `defaultMailboxSettings.aiEnabled` so a caller that
 * genuinely has no account context yet still gets a sane value.
 *
 * `overrides === undefined` with `aiEnabled` left at its own default
 * returns `defaultMailboxSettings` unchanged (by reference) - the common
 * "no settings message at all" case.
 *
 * Does NOT know about the global `AI_ENABLED` flag - the "opt-out can only
 * turn AI off, never on" rule is enforced separately, where both values are
 * already in scope (`application/scanning/ai-classification.step.ts`'s
 * existing `settings.aiEnabled && globalAiConfig.enabled` check).
 */
export function resolveMailboxSettings(
  overrides: OverridableSettings | undefined,
  aiEnabled: boolean = defaultMailboxSettings.aiEnabled,
): MailboxSettings {
  if (
    overrides === undefined &&
    aiEnabled === defaultMailboxSettings.aiEnabled
  ) {
    return defaultMailboxSettings;
  }

  return {
    folders: { ...defaultMailboxSettings.folders, ...overrides?.folders },
    scanRead: overrides?.scanRead ?? defaultMailboxSettings.scanRead,
    scanInitialState:
      overrides?.scanInitialState ?? defaultMailboxSettings.scanInitialState,
    processingMode:
      overrides?.processingMode ?? defaultMailboxSettings.processingMode,
    labels: { ...defaultMailboxSettings.labels, ...overrides?.labels },
    thresholds: {
      ...defaultMailboxSettings.thresholds,
      ...overrides?.thresholds,
    },
    aiEscalation: {
      ...defaultMailboxSettings.aiEscalation,
      ...overrides?.aiEscalation,
    },
    aiEnabled,
  };
}
