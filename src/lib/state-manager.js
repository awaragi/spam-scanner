import {config} from './utils/config.js';
import {fetchMessagesByUIDs, open, search} from "./imap-client.js";
import {formatStateAsEmail, parseStateFromEmail, validateState} from "./utils/state-utils.js";

export async function readScannerState(imap, defaultState) {
  try {
    // Open the state folder in read-only mode
    await open(imap, config.FOLDER_STATE, true);

    // Search for state messages
    const criteria = {
      header: {
        'X-App-State': config.STATE_KEY_SCANNER
      }
    };
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

    return json;

  } catch (error) {
    throw error;
  }
}

export async function writeScannerState(imap, state) {
  // Validate state object before writing
  validateState(state);

  // Format state as email
  const raw = formatStateAsEmail(state, config.STATE_KEY_SCANNER);

  try {
    // Open the state folder
    await imap.mailboxOpen(config.FOLDER_STATE, { readOnly: false });

    // Search for existing state messages
    const criteria = { header: [{ key: 'X-App-State', value: config.STATE_KEY_SCANNER }] };
    const results = await imap.search(criteria);

    // Delete existing state messages if any
    if (results.length > 0) {
      await imap.messageFlagsAdd({ uid: results }, ['\\Deleted']);
      await imap.mailboxExpunge();
    }

    // Append the new state message
    await imap.append(config.FOLDER_STATE, raw, ['\\Seen']);

    return true;
  } catch (error) {
    throw error;
  }
}

export async function deleteScannerState(imap) {
  try {
    // Open the state folder
    await imap.mailboxOpen(config.FOLDER_STATE, { readOnly: false });

    // Search for state messages
    const criteria = { header: [{ key: 'X-App-State', value: config.STATE_KEY_SCANNER }] };
    const results = await imap.search(criteria);

    if (results.length === 0) {
      return false;
    }

    // Delete state messages
    await imap.messageFlagsAdd({ uid: results }, ['\\Deleted']);
    await imap.mailboxExpunge();

    return true;
  } catch (error) {
    throw error;
  }
}
