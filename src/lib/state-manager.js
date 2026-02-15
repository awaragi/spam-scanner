import {config} from './utils/config.js';
import {fetchMessagesByUIDs, open, search} from "./imap-client.js";
import {formatStateAsEmail, parseStateFromEmail, validateState} from "./utils/state-utils.js";

const criteria = {
  header: {
    'X-App-State': config.STATE_KEY_SCANNER
  }
};

function buildStateCriteria(stateKey) {
  return {
    header: {
      'X-App-State': stateKey
    }
  };
}

function formatMapAsEmail(mapContent, stateKey) {
  return `From: Map State <scanner@localhost>
To: Map State <scanner@localhost>
Subject: AppState: ${stateKey}
X-App-State: ${stateKey}
Content-Type: text/plain; charset=utf-8
MIME-Version: 1.0

${mapContent}`;
}

export async function readScannerState(imap, defaultState) {
    // remember original mailbox
    const originalPath = imap.mailbox?.path;

    // Open the state folder in read-only mode
    await open(imap, config.FOLDER_STATE, true);

    // Search for state messages
    const results = await search(imap, criteria);

    if (results.length === 0) {
      if (defaultState !== undefined) {
        return defaultState;
      } else {
        throw new Error('Scanner state not found');
      }
    }

    // Fetch and parse the state message
    const messages = await fetchMessagesByUIDs(imap, [results[0]]);

    if (messages.length === 0) {
      throw new Error('Failed to fetch state message');
    }

    const json = parseStateFromEmail(messages[0].body);

    // Validate json after reading
    validateState(json);

    if (!json) {
      throw new Error('Failed to parse state from email');
    }

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
        await imap.mailboxOpen(config.FOLDER_STATE, {readOnly: false});

        // Search for existing state messages
        const results = await search(imap, criteria);

        // Delete existing state messages if any
        if (results.length > 0) {
            await imap.messageDelete(criteria);
        }

        // Append the new state message
        await imap.append(config.FOLDER_STATE, raw, ['\\Seen']);

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
    const raw = formatMapAsEmail(mapContent, mapStateKey);
    const mapCriteria = buildStateCriteria(mapStateKey);

    await imap.mailboxOpen(config.FOLDER_STATE, {readOnly: false});

    const results = await search(imap, mapCriteria);

    if (results.length > 0) {
      await imap.messageDelete(mapCriteria);
    }

    await imap.append(config.FOLDER_STATE, raw, ['\\Seen']);

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
