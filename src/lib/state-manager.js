import {simpleParser} from 'mailparser';
import {config} from './utils/config.js';
import {connect} from "./imap-client.js";
import {validateState, formatStateAsEmail, parseStateFromEmail} from "./utils/state-utils.js";

export async function readScannerState(defaultState) {
  const imap = connect();

  return new Promise((resolve, reject) => {
    imap.once('ready', () => {
      imap.openBox(config.FOLDER_STATE, true, (err) => {
        if (err) return reject(err);

        const criteria = [['HEADER', 'X-App-State', config.STATE_KEY_SCANNER]];
        imap.search(criteria, (err, results) => {
          if (err || results.length === 0) {
            if (defaultState !== undefined) {
              imap.end();
              resolve(defaultState);
              return;
            } else {
              imap.end();
              return reject(new Error('Scanner state not found'));
            }
          }

          let uid = results[0];

          const f = imap.fetch(uid, { bodies: '' });

          f.on('message', msg => {
            msg.on('body', stream => {
              simpleParser(stream)
                  .then(parsed => {
                    const json = parseStateFromEmail(parsed.text);
                    
                    // validate json after reading
                    validateState(json);

                    if (json) {
                      resolve(json);
                    } else {
                      console.error('Failed to parse state from email');
                      reject(new Error('Failed to parse state from email'));
                    }
                  })
                  .catch(err => {
                    console.error('Mail parsing error:', err.message);
                    reject(new Error(`Failed to parse email: ${err.message}`));
                  });
            });
          });

          f.once('error', reject);
          f.once('end', () => imap.end());
        });
      });
    });

    imap.once('error', reject);
    imap.connect();
  });
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
