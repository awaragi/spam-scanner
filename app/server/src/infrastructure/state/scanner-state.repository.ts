import type { ImapFlow, SearchObject } from 'imapflow';
import type { Logger as PinoLogger } from 'pino';
import {
  formatStateAsEmail,
  parseStateFromEmail,
  validateState,
  STATE_KEY_SCANNER,
  type ScannerState,
} from '../../domain/state/state-format.js';
import { parseEmail } from '../../domain/utils/email-parser.js';
import { open, search, fetchMessagesByUIDs } from '../imap/mailbox.gateway.js';

const criteria: SearchObject = {
  header: {
    'X-App-State': STATE_KEY_SCANNER,
  },
};

/**
 * Extract the body text from an RFC822 message's raw buffer.
 * `fetchMessagesByUIDs` returns objects with a `raw` field containing the
 * full RFC822 message (headers + blank line + body). State messages are
 * formatted by `formatStateAsEmail`, so the JSON payload `parseStateFromEmail`
 * expects is everything after that blank line.
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

/**
 * Read scanner state from the mailbox's state folder.
 *
 * If no state message exists and a default is provided, initializes a default
 * state with the `last_uid` determined by `SCAN_INITIAL_STATE` setting. If no
 * default is provided and no state exists, throws.
 *
 * @param imap - Connected ImapFlow client
 * @param defaultState - Default state to use if none exists
 * @param mailboxPath - Path to the target mailbox (for UIDNEXT calculation in default state)
 * @param stateFolder - Path to the state folder
 * @param scanInitialState - The SCAN_INITIAL_STATE setting ('new' or 'all')
 * @param logger - Optional logger for warnings
 * @returns The scanner state
 * @throws If no state exists and no default is provided
 */
export async function readScannerState(
  imap: ImapFlow,
  stateFolder: string,
  defaultState?: ScannerState,
  mailboxPath?: string,
  scanInitialState: 'new' | 'all' = 'new',
  logger?: PinoLogger
): Promise<ScannerState> {
  // remember original mailbox
  const originalPath = currentMailboxPath(imap);

  // Open the state folder in read-only mode
  await open(imap, stateFolder, true, logger);

  // Search for state messages
  const results = await search(imap, criteria, logger);

  if (results.length === 0) {
    if (defaultState !== undefined) {
      let last_uid = defaultState.last_uid;

      if (mailboxPath && scanInitialState !== 'all') {
        // Avoid defaulting to last_uid: 0 on a non-empty mailbox, which would
        // trigger a full re-scan - peek UIDNEXT (no SELECT needed) and start
        // from "new mail only" instead. Skipped entirely when
        // SCAN_INITIAL_STATE=all, which deliberately wants the full-mailbox
        // scan this guard normally avoids.
        const status = await imap.status(mailboxPath, { uidNext: true });
        // uidNext is guaranteed by the `{ uidNext: true }` query above, even
        // though imapflow's own types mark it optional.
        last_uid = status.uidNext! > 1 ? status.uidNext! - 1 : 0;
      }

      logger?.warn(
        { mailboxPath, last_uid, initialState: scanInitialState },
        'No scanner state found, using default state'
      );

      // Restore original mailbox if it existed
      if (originalPath) {
        await imap.mailboxOpen(originalPath);
      }

      return { ...defaultState, last_uid };
    } else {
      throw new Error('Scanner state not found');
    }
  }

  // Fetch and parse the state message from the highest-UID match (the most
  // recently written one) - append-before-delete writes can transiently leave
  // more than one match if a write is interrupted between append and delete.
  const latestUid = Math.max(...results);
  const messages = await fetchMessagesByUIDs(imap, [latestUid], logger);

  if (messages.length === 0) {
    throw new Error('Failed to fetch state message');
  }

  const json = parseStateFromEmail(bodyOf(messages[0]));

  if (!json) {
    throw new Error('Failed to parse state from email');
  }

  // Validate json after reading - throws if invalid
  validateState(json);

  // Restore original mailbox if it existed
  if (originalPath) {
    await imap.mailboxOpen(originalPath);
  }

  return json as ScannerState;
}

/**
 * Write scanner state to the mailbox's state folder.
 *
 * Follows the append-before-delete pattern: the new state message is appended
 * first, and only after a successful append are any previous state messages
 * deleted. This ensures at least one valid state message always exists, even
 * if the write is interrupted.
 *
 * @param imap - Connected ImapFlow client
 * @param stateFolder - Path to the state folder
 * @param state - The state object to write
 * @param logger - Optional logger
 * @returns true on success
 * @throws If validation fails or the write operation fails
 */
export async function writeScannerState(
  imap: ImapFlow,
  stateFolder: string,
  state: unknown,
  logger?: PinoLogger
): Promise<boolean> {
  // remember original mailbox
  const originalPath = currentMailboxPath(imap);

  // Validate state object before writing
  validateState(state);

  // Format state as email
  const raw = formatStateAsEmail(state, STATE_KEY_SCANNER);

  // Open the state folder
  await imap.mailboxOpen(stateFolder, { readOnly: false });

  // Search for existing state messages, so they can be deleted by UID
  // *after* the new one is safely appended (append-before-delete: a
  // failed append must never leave the state folder with no valid state).
  const oldUids = await search(imap, criteria, logger);

  // Append the new state message first
  await imap.append(stateFolder, raw, ['\\Seen']);

  // Only now delete the previously-captured old state message(s)
  if (oldUids.length > 0) {
    await imap.messageDelete(oldUids, { uid: true });
  }

  // Restore original mailbox if it existed
  if (originalPath) {
    await imap.mailboxOpen(originalPath);
  }

  return true;
}

/**
 * Delete all scanner state messages from the state folder.
 *
 * @param imap - Connected ImapFlow client
 * @param stateFolder - Path to the state folder
 * @param logger - Optional logger
 * @returns true if any messages were deleted, false if none existed
 */
export async function deleteScannerState(
  imap: ImapFlow,
  stateFolder: string,
  logger?: PinoLogger
): Promise<boolean> {
  // Open the state folder
  await imap.mailboxOpen(stateFolder, { readOnly: false });

  // Search for state messages
  const results = await search(imap, criteria, logger);

  if (results.length === 0) {
    return false;
  }

  // Delete state messages
  await imap.messageDelete(results, { uid: true });

  return true;
}
