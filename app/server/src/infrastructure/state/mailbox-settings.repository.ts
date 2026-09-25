import type { ImapFlow, SearchObject } from 'imapflow';
import type { Logger as PinoLogger } from 'pino';
import {
  formatAppStateEmail,
  parseStateFromEmail,
  STATE_KEY_MAILBOX_SETTINGS,
} from '../../domain/state/state-format.js';
import { parseEmail } from '../../domain/utils/email-parser.js';
import { open, search, fetchMessagesByUIDs } from '../imap/mailbox.gateway.js';

/**
 * Extract the body text from an RFC822 message's raw buffer.
 */
function bodyOf(message: { raw: Buffer }): string {
  return parseEmail(message.raw.toString()).body;
}

/**
 * Get the current mailbox path, handling imapflow's `false` for "nothing
 * selected" by narrowing via truthy check rather than optional chaining.
 */
function currentMailboxPath(imap: ImapFlow): string | undefined {
  return imap.mailbox ? imap.mailbox.path : undefined;
}

// There is only ever one settings message per mailbox (not one per key), so
// this criteria is hardcoded to STATE_KEY_MAILBOX_SETTINGS rather than taking
// a key parameter the way sender-list.repository.ts's buildStateCriteria does.
const criteria: SearchObject = {
  header: {
    'X-App-State': STATE_KEY_MAILBOX_SETTINGS,
  },
};

/**
 * Narrows a parsed JSON value to a plain object suitable as a settings
 * overrides map, rejecting arrays, `null`, and primitives.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read settings overrides from the mailbox's state folder.
 *
 * When multiple settings messages exist (e.g., after an interruption between
 * append and delete), selects the highest-UID message. "No settings message"
 * and "settings message that fails to parse as a JSON object" both return
 * `undefined` rather than throwing or defaulting to `{}` - per the spec,
 * absence of a settings message is a valid, permanent state (a mailbox that
 * has never had its settings updated runs on defaults indefinitely), so it is
 * not logged. A message that exists but fails to parse/isn't an object is
 * logged as a warning, since that's a real (if rare) difference worth
 * flagging distinctly from "never configured".
 *
 * @param imap - Connected ImapFlow client
 * @param stateFolder - Path to the state folder
 * @param logger - Optional logger
 * @returns The stored overrides object, or `undefined` if none exists or it
 *   failed to parse as a JSON object
 */
export async function readSettingsOverrides(
  imap: ImapFlow,
  stateFolder: string,
  logger?: PinoLogger
): Promise<Record<string, unknown> | undefined> {
  // remember original mailbox
  const originalPath = currentMailboxPath(imap);

  // Open the state folder in read-only mode
  await open(imap, stateFolder, true, logger);

  // Search for settings messages
  const results = await search(imap, criteria, logger);

  if (results.length === 0) {
    if (originalPath) {
      await imap.mailboxOpen(originalPath);
    }
    // No settings message at all is the normal, expected steady state for a
    // mailbox with no overrides - nothing to warn about.
    return undefined;
  }

  // Fetch and parse the settings message from the highest-UID match (the most
  // recently written one) - append-before-delete writes can transiently leave
  // more than one match if a write is interrupted between append and delete.
  const latestUid = Math.max(...results);
  const messages = await fetchMessagesByUIDs(imap, [latestUid], logger);

  if (originalPath) {
    await imap.mailboxOpen(originalPath);
  }

  if (messages.length === 0) {
    return undefined;
  }

  const parsed = parseStateFromEmail(bodyOf(messages[0]));

  if (!isPlainObject(parsed)) {
    logger?.warn(
      { stateFolder, uid: latestUid },
      'Settings message exists but failed to parse as a JSON object; running on defaults'
    );
    return undefined;
  }

  return parsed;
}

/**
 * Write settings overrides to the mailbox's state folder.
 *
 * Follows the append-before-delete pattern: the new settings message is
 * appended first, and only after a successful append are any previous
 * settings message(s) deleted. This ensures at least one valid settings
 * message always exists (or none, if there never was one), even if the write
 * is interrupted.
 *
 * @param imap - Connected ImapFlow client
 * @param stateFolder - Path to the state folder
 * @param overrides - The overrides object to write (JSON-stringified)
 * @param logger - Optional logger
 * @throws If the write operation fails
 */
export async function writeSettingsOverrides(
  imap: ImapFlow,
  stateFolder: string,
  overrides: Record<string, unknown>,
  logger?: PinoLogger
): Promise<void> {
  // remember original mailbox
  const originalPath = currentMailboxPath(imap);

  const raw = formatAppStateEmail(
    STATE_KEY_MAILBOX_SETTINGS,
    JSON.stringify(overrides),
    'Mailbox Settings'
  );

  // Open the state folder read-write
  await imap.mailboxOpen(stateFolder, { readOnly: false });

  // Search first, so old messages can be deleted by UID *after* the new one
  // is safely appended (append-before-delete: a failed append must never
  // leave the state folder with no valid settings message).
  const oldUids = await search(imap, criteria, logger);

  await imap.append(stateFolder, raw, ['\\Seen']);

  // Only now delete the previously-captured old settings message(s)
  if (oldUids.length > 0) {
    await imap.messageDelete(oldUids, { uid: true });
  }

  // Restore original mailbox if it existed
  if (originalPath) {
    await imap.mailboxOpen(originalPath);
  }
}
