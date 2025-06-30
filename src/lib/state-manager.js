import {config} from './utils/config.js';
import {connect, open, fetchMessagesByUIDs, search} from "./imap-client.js";
import {validateState, formatStateAsEmail, parseStateFromEmail} from "./utils/state-utils.js";

export async function readScannerState(defaultState) {
  const imap = connect();

  try {
    // Open the state folder in read-only mode
    await open(imap, config.FOLDER_STATE, true);

    // Search for state messages
    const criteria = [['HEADER', 'X-App-State', config.STATE_KEY_SCANNER]];
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

    const body = messages[0].raw.trim().split('\n\n').slice(1);
    const json = parseStateFromEmail(body);
    
    // Validate json after reading
    validateState(json);

    if (!json) {
      throw new Error('Failed to parse state from email');
    }

    return json;

  } catch (error) {
    throw error;
  } finally {
    imap.end();
  }
}

export async function writeScannerState(state) {
  const imap = connect();

  // Validate state object before writing
  validateState(state);

  // Format state as email
  const raw = formatStateAsEmail(state, config.STATE_KEY_SCANNER);

  return new Promise((resolve, reject) => {
    imap.once('ready', () => {
      imap.openBox(config.FOLDER_STATE, false, (err) => {
        if (err) return reject(err);

        const criteria = [['HEADER', 'X-App-State', config.STATE_KEY_SCANNER]];
        imap.search(criteria, (err, results) => {
          const appendAndResolve = () => {
            imap.append(raw, {mailbox: config.FOLDER_STATE, flags: ['\\Seen']}, err => {
              if (err) return reject(err);
              imap.end();
              resolve();
            });
          };

          if (results.length > 0) {
            imap.addFlags(results, '\\Deleted', (err) => {
              if (err) return reject(err);
              imap.expunge(() => appendAndResolve());
            });
          } else {
            appendAndResolve();
          }
        });
      });
    });
    imap.once('error', reject);
    imap.connect();
  });
}

export async function deleteScannerState() {
  const imap = connect();

  return new Promise((resolve, reject) => {
    imap.once('ready', () => {
      imap.openBox(config.FOLDER_STATE, false, (err) => {
        if (err) return reject(err);

        const criteria = [['HEADER', 'X-App-State', config.STATE_KEY_SCANNER]];
        imap.search(criteria, (err, results) => {
          if (err || results.length === 0) {
            imap.end();
            return resolve(false);
          }

          imap.addFlags(results, '\\Deleted', (err) => {
            if (err) return reject(err);
            imap.expunge(() => {
              imap.end();
              resolve(true);
            });
          });
        });
      });
    });

    imap.once('error', reject);
    imap.connect();
  });
}