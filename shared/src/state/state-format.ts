import { z } from 'zod';

/**
 * Utility functions for state management
 */

/**
 * State-message keys within per-mailbox state folder identifying each piece of
 * JSON state (scanner progress, whitelist, blacklist, settings overrides).
 * The first three must remain unchanged for compatibility with state already
 * stored in existing mailboxes; `STATE_KEY_MAILBOX_SETTINGS` is additive.
 */
export const STATE_KEY_SCANNER = 'scanner';
export const STATE_KEY_WHITELIST_MAP = 'rspamd-whitelist-map';
export const STATE_KEY_BLACKLIST_MAP = 'rspamd-blacklist-map';
export const STATE_KEY_MAILBOX_SETTINGS = 'mailbox-settings';

const REQUIRED_STATE_PROPERTIES = [
  'last_uid',
  'last_seen_date',
  'last_checked',
];
// Additive, optional fields - schema evolution should extend this list rather
// than break existing stored state (see finding 6.17). uid_validity is a
// string because IMAP UIDVALIDITY is a BigInt in imapflow and JSON.stringify
// can't serialize BigInt directly.
const OPTIONAL_STATE_PROPERTIES = ['uid_validity'];

/**
 * The single source of truth for a scanner state's field-level shape -
 * shared with `server`'s `PUT .../state` request body schema
 * (`state-write.schema.ts`) so the API boundary and this internal reader
 * can never independently drift on what counts as a well-formed field
 * value. `last_uid` must be a non-negative integer (IMAP UIDs are) and the
 * date fields must be non-empty - stricter than a bare `typeof` check, by
 * design: this is what "valid" scanner state actually means, not just
 * "JSON-shaped like one".
 */
export const scannerStateSchema = z
  .object({
    last_uid: z.number().int().nonnegative(),
    last_seen_date: z.string().min(1),
    last_checked: z.string().min(1),
    uid_validity: z.string().min(1).optional(),
  })
  .strict();

export type ScannerState = z.infer<typeof scannerStateSchema>;

/**
 * Validates a state object
 * @param state - State object to validate
 * @throws {Error} - If state is invalid
 * @returns - True if state is valid
 */
export function validateState(state: unknown): state is ScannerState {
  if (!state || typeof state !== 'object') {
    throw new Error('Invalid state: must be a non-null object');
  }

  const stateKeys = Object.keys(state);

  // Check for missing required properties
  const missingProperties = REQUIRED_STATE_PROPERTIES.filter(
    (prop) => !(prop in state),
  );
  if (missingProperties.length > 0) {
    throw new Error('Invalid state: missing required properties');
  }

  // Check for invalid property names (extra properties not in the known list)
  const allowedProperties = [
    ...REQUIRED_STATE_PROPERTIES,
    ...OPTIONAL_STATE_PROPERTIES,
  ];
  const invalidProperties = stateKeys.filter(
    (key) => !allowedProperties.includes(key),
  );
  if (invalidProperties.length > 0) {
    throw new Error('Invalid state: invalid property names');
  }

  // Field-level shape (types plus the non-negative-integer/non-empty-string
  // refinements) is `scannerStateSchema`'s job, not a second hand-rolled copy.
  if (!scannerStateSchema.safeParse(state).success) {
    throw new Error('Invalid state: invalid property types');
  }

  return true;
}

/**
 * Formats an app-state body (JSON state or raw map content) as an email
 * message, using the shared X-App-State envelope both scanner state and
 * map-state backups rely on to be found again by `search`.
 * @param stateKey - Key to identify the state
 * @param body - Raw text to place in the message body
 * @param [displayName] - From/To display name
 * @returns - Formatted email message
 */
export function formatAppStateEmail(
  stateKey: string,
  body: string,
  displayName = 'App State',
): string {
  return `From: ${displayName} <scanner@localhost>
To: ${displayName} <scanner@localhost>
Subject: AppState: ${stateKey}
X-App-State: ${stateKey}
Content-Type: text/plain; charset=utf-8
MIME-Version: 1.0

${body}`;
}

/**
 * Formats a state object as an email message
 * @param state - State object to format
 * @param stateKey - Key to identify the state
 * @returns - Formatted email message
 */
export function formatStateAsEmail(state: unknown, stateKey: string): string {
  validateState(state);

  const stateJson = JSON.stringify(state, null, 2);

  return formatAppStateEmail(stateKey, stateJson, 'Scanner State');
}

/**
 * Parses a state from email content
 * @param emailContent - Email content containing state
 * @returns - Parsed state object or null if parsing failed
 */
export function parseStateFromEmail(emailContent: string): unknown {
  try {
    return JSON.parse(emailContent);
  } catch {
    return null;
  }
}
