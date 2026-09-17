import { config } from './utils/config.js';
import { fetchMessagesByUIDs, open, search } from './clients/imap-client.js';
import {
  formatAppStateEmail,
  formatStateAsEmail,
  parseStateFromEmail,
  validateState,
} from './utils/state-utils.js';
import { rootLogger } from './utils/logger.js';

const logger = rootLogger.forComponent('state-manager');

const criteria = {
  header: {
    'X-App-State': config.STATE_KEY_SCANNER,
  },
};

function buildStateCriteria(stateKey) {
  return {
    header: {
      'X-App-State': stateKey,
    },
  };
}

export async function readScannerState(imap, defaultState, mailboxPath) {
  // remember original mailbox
  const originalPath = imap.mailbox?.path;

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
        last_uid = status.uidNext > 1 ? status.uidNext - 1 : 0;
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

  const json = parseStateFromEmail(messages[0].body);

  if (!json) {
    throw new Error('Failed to parse state from email');
  }

  // Validate json after reading
  validateState(json);

  // Restore original mailbox if it existed
  if (originalPath) {
    await imap.mailboxOpen(originalPath);
  }

  return json;
}

export async function writeScannerState(imap, state) {
  // remember original mailbox
  const originalPath = imap.mailbox?.path;

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

export async function writeMapState(imap, mapStateKey, mapContent) {
  if (typeof mapContent !== 'string') {
    throw new Error('Invalid map content: expected a string');
  }

  const originalPath = imap.mailbox?.path;
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

export async function deleteScannerState(imap) {
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
