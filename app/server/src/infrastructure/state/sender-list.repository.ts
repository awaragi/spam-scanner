import type { ImapFlow, SearchObject } from 'imapflow';
import type { Logger as PinoLogger } from 'pino';
import {
  formatAppStateEmail,
  parseStateFromEmail,
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

/**
 * Build search criteria for a specific state key.
 */
function buildStateCriteria(stateKey: string): SearchObject {
  return {
    header: {
      'X-App-State': stateKey,
    },
  };
}

/**
 * Read map/list state (whitelist or blacklist) from the state folder.
 *
 * When multiple state messages exist for the same key (e.g., after an
 * interruption between append and delete), selects the highest-UID message.
 * Missing or unparseable messages default to an empty list rather than
 * throwing.
 *
 * @param imap - Connected ImapFlow client
 * @param stateFolder - Path to the state folder
 * @param mapStateKey - The state key identifying this map (e.g. STATE_KEY_WHITELIST_MAP)
 * @param logger - Optional logger
 * @returns Array of addresses, or empty array if no state exists or is invalid
 */
export async function readMapState(
  imap: ImapFlow,
  stateFolder: string,
  mapStateKey: string,
  logger?: PinoLogger
): Promise<string[]> {
  // remember original mailbox
  const originalPath = currentMailboxPath(imap);

  // Open the state folder in read-only mode
  await open(imap, stateFolder, true, logger);

  // Search for state messages matching this list's key
  const results = await search(imap, buildStateCriteria(mapStateKey), logger);

  if (results.length === 0) {
    if (originalPath) {
      await imap.mailboxOpen(originalPath);
    }
    return [];
  }

  // Fetch and parse the state message from the highest-UID match (the most
  // recently written one) - same rationale as readScannerState.
  const latestUid = Math.max(...results);
  const messages = await fetchMessagesByUIDs(imap, [latestUid], logger);

  if (originalPath) {
    await imap.mailboxOpen(originalPath);
  }

  if (messages.length === 0) {
    return [];
  }

  const parsed = parseStateFromEmail(bodyOf(messages[0]));

  // A missing message, unparseable JSON, or JSON that isn't an address array
  // (e.g. a legacy newline-delimited plain-text backup, or malformed content)
  // is treated the same as no state at all, rather than throwing.
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed as string[];
}

/**
 * Write map/list state (whitelist or blacklist) to the state folder.
 *
 * Follows the append-before-delete pattern: the new state message is appended
 * first, and only after a successful append are any previous state messages
 * deleted.
 *
 * @param imap - Connected ImapFlow client
 * @param stateFolder - Path to the state folder
 * @param mapStateKey - The state key identifying this map (e.g. STATE_KEY_WHITELIST_MAP)
 * @param mapContent - The content to write (will be converted to JSON)
 * @param logger - Optional logger
 * @returns true on success
 * @throws If the write operation fails
 */
export async function writeMapState(
  imap: ImapFlow,
  stateFolder: string,
  mapStateKey: string,
  mapContent: unknown,
  logger?: PinoLogger
): Promise<boolean> {
  // Serialize the content (mapContent can be an array or object)
  const contentString = typeof mapContent === 'string'
    ? mapContent
    : JSON.stringify(mapContent);

  const originalPath = currentMailboxPath(imap);
  const raw = formatAppStateEmail(mapStateKey, contentString, 'Map State');
  const mapCriteria = buildStateCriteria(mapStateKey);

  await imap.mailboxOpen(stateFolder, { readOnly: false });

  // Search first, so old messages can be deleted by UID *after* the new one
  // is safely appended (see readScannerState/writeScannerState for the
  // append-before-delete rationale).
  const oldUids = await search(imap, mapCriteria, logger);

  await imap.append(stateFolder, raw, ['\\Seen']);

  if (oldUids.length > 0) {
    await imap.messageDelete(oldUids, { uid: true });
  }

  if (originalPath) {
    await imap.mailboxOpen(originalPath);
  }

  return true;
}
