import type { ImapFlow, SearchObject } from 'imapflow';
import { config } from '../core/config.ts';
import { fetchMessagesByUIDs, open, search } from './imap.client.ts';
import {
  formatAppStateEmail,
  formatStateAsEmail,
  parseStateFromEmail,
  validateState,
  type ScannerState,
} from '../services/state-format.service.ts';
import { parseEmail } from '../utils/email-parser.util.ts';
import { rootLogger } from '../core/logger.ts';

const logger = rootLogger.forComponent('state-manager');

const criteria: SearchObject = {
  header: {
    'X-App-State': config.STATE_KEY_SCANNER,
  },
};

function buildStateCriteria(stateKey: string): SearchObject {
  return {
    header: {
      'X-App-State': stateKey,
    },
  };
}

/**
 * `fetchMessagesByUIDs` (imap.client.ts) returns `{uid, flags, envelope,
 * raw}` objects - `raw` is the full RFC822 message (headers + blank line +
 * body). State messages are formatted by `formatAppStateEmail`/
 * `formatStateAsEmail`, so the JSON payload `parseStateFromEmail` expects is
 * everything after that blank line - `parseEmail()` splits the two apart.
 */
function bodyOf(message: { raw: Buffer }): string {
  return parseEmail(message.raw.toString()).body;
}

// `imap.mailbox` is typed `MailboxObject | false` (imapflow uses `false` for
// "nothing selected"); narrowing via a truthy check (rather than `?.`, which
// doesn't narrow away a non-nullish `false`) gets a real MailboxObject.
function currentMailboxPath(imap: ImapFlow): string | undefined {
  return imap.mailbox ? imap.mailbox.path : undefined;
}

export async function readScannerState(
  imap: ImapFlow,
  defaultState?: ScannerState,
  mailboxPath?: string
): Promise<ScannerState> {
  // remember original mailbox
  const originalPath = currentMailboxPath(imap);

  // Open the state folder in read-only mode
  await open(imap, config.FOLDER_STATE, true);

  // Search for state messages
  const results = await search(imap, criteria);

  if (results.length === 0) {
    if (defaultState !== undefined) {
      let last_uid = defaultState.last_uid;

      if (mailboxPath && config.SCAN_INITIAL_STATE !== 'all') {
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

      logger.warn(
        { mailboxPath, last_uid, initialState: config.SCAN_INITIAL_STATE },
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
  const messages = await fetchMessagesByUIDs(imap, [latestUid]);

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

export async function writeScannerState(
  imap: ImapFlow,
  state: unknown
): Promise<boolean> {
  // remember original mailbox
  const originalPath = currentMailboxPath(imap);

  // Validate state object before writing
  validateState(state);

  // Format state as email
  const raw = formatStateAsEmail(state, config.STATE_KEY_SCANNER);

  // Open the state folder
  await imap.mailboxOpen(config.FOLDER_STATE, { readOnly: false });

  // Search for existing state messages, so they can be deleted by UID
  // *after* the new one is safely appended (append-before-delete: a
  // failed append must never leave the state folder with no valid state).
  const oldUids = await search(imap, criteria);

  // Append the new state message first
  await imap.append(config.FOLDER_STATE, raw, ['\\Seen']);

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

export async function readMapState(
  imap: ImapFlow,
  mapStateKey: string
): Promise<string[]> {
  // remember original mailbox
  const originalPath = currentMailboxPath(imap);

  // Open the state folder in read-only mode
  await open(imap, config.FOLDER_STATE, true);

  // Search for state messages matching this list's key
  const results = await search(imap, buildStateCriteria(mapStateKey));

  if (results.length === 0) {
    if (originalPath) {
      await imap.mailboxOpen(originalPath);
    }
    return [];
  }

  // Fetch and parse the state message from the highest-UID match (the most
  // recently written one) - same rationale as readScannerState.
  const latestUid = Math.max(...results);
  const messages = await fetchMessagesByUIDs(imap, [latestUid]);

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

export async function writeMapState(
  imap: ImapFlow,
  mapStateKey: string,
  mapContent: string
): Promise<boolean> {
  if (typeof mapContent !== 'string') {
    throw new Error('Invalid map content: expected a string');
  }

  const originalPath = currentMailboxPath(imap);
  const raw = formatAppStateEmail(mapStateKey, mapContent, 'Map State');
  const mapCriteria = buildStateCriteria(mapStateKey);

  await imap.mailboxOpen(config.FOLDER_STATE, { readOnly: false });

  // Search first, so old messages can be deleted by UID *after* the new one
  // is safely appended (see writeScannerState for the same append-before-delete rationale).
  const oldUids = await search(imap, mapCriteria);

  await imap.append(config.FOLDER_STATE, raw, ['\\Seen']);

  if (oldUids.length > 0) {
    await imap.messageDelete(oldUids, { uid: true });
  }

  if (originalPath) {
    await imap.mailboxOpen(originalPath);
  }

  return true;
}

export async function deleteScannerState(imap: ImapFlow): Promise<boolean> {
  // Open the state folder
  await imap.mailboxOpen(config.FOLDER_STATE, { readOnly: false });

  // Search for state messages
  const results = await search(imap, criteria);

  if (results.length === 0) {
    return false;
  }

  // Delete state messages
  await imap.messageDelete(criteria);

  return true;
}
