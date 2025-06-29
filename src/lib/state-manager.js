import {simpleParser} from 'mailparser';
import {config} from './utils/config.js';
import {connect} from "./imap-client.js";

export async function readScannerState() {
  const imap = connect();

  return new Promise((resolve, reject) => {
    imap.once('ready', () => {
      imap.openBox(config.FOLDER_STATE, true, (err) => {
        if (err) return reject(err);

        const criteria = [['HEADER', 'X-App-State', config.STATE_KEY_SCANNER]];
        imap.search(criteria, (err, results) => {
          if (err || results.length === 0) {
            imap.end();
            return reject(new Error('Scanner state not found'));
          }

          const f = imap.fetch(results[0], { bodies: '' });

          f.on('message', msg => {
            msg.on('body', stream => {
              simpleParser(stream)
                  .then(parsed => {
                    try {
                      const json = JSON.parse(parsed.text);
                      resolve(json);
                    } catch (parseErr) {
                      console.error('JSON parsing error:', parseErr.message);
                      console.error('Raw text content:', parsed.text);
                      reject(new Error(`Failed to parse state JSON: ${parseErr.message}`));
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
  if (!state || typeof state !== 'object') {
    throw new Error('Invalid state: must be a non-null object');
  }

  const stateJson = JSON.stringify(state, null, 2);

  // Ensure the email format is plain text with proper headers
  // and JSON content is directly in the body
  const raw = `From: Scanner State <scanner@localhost>
To: Scanner State <scanner@localhost>
Subject: AppState: ${config.STATE_KEY_SCANNER}
X-App-State: ${config.STATE_KEY_SCANNER}
Content-Type: text/plain; charset=utf-8
MIME-Version: 1.0

${stateJson}`;

  return new Promise((resolve, reject) => {
    imap.once('ready', () => {
      imap.openBox(config.FOLDER_STATE, false, (err) => {
        if (err) return reject(err);

        const criteria = [['HEADER', 'X-App-State', config.STATE_KEY_SCANNER]];
        imap.search(criteria, (err, results) => {
          const appendAndResolve = () => {
            imap.append(raw, { mailbox: config.FOLDER_STATE }, err => {
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
