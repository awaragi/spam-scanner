import Imap from 'imap';
import {getConfig} from './util.js';
import pino from 'pino';

const config = getConfig();
const logger = pino();

export function connect() {
  return new Imap({
    user: config.IMAP_USER,
    password: config.IMAP_PASSWORD,
    host: config.IMAP_HOST,
    port: config.IMAP_PORT,
    tls: config.IMAP_TLS === true,
  });
}

export async function createAppFolders(folders) {
  const imap = connect();
  
  return new Promise((resolve, reject) => {
    imap.once('ready', () => {
      let pending = folders.length;
      
      if (pending === 0) {
        imap.end();
        return resolve();
      }

      folders.forEach(folder => {
        const parts = folder.split(/[/.]/);
        const separator = folder.match(/[/.]/) ? folder.match(/[/.]/)[0] : '.';
        let currentPath = '';

        // Create folders sequentially to avoid race conditions
        const createNextPart = (index) => {
          if (index >= parts.length) {
            if (--pending === 0) {
              imap.end();
              resolve();
            }
            return;
          }

          const part = parts[index];
          currentPath = currentPath ? `${currentPath}${separator}${part}` : part;
          logger.info({folder: currentPath}, `Creating folder ${currentPath}`);

          imap.addBox(currentPath, err => {
            if (err && err.message && err.message.includes('exists')) {
              logger.info({folder: currentPath}, 'Folder exists');
            } else if (err) {
              logger.error({folder: currentPath, error: err.message}, 'Failed to create folder');
              // Continue with next part even if this one failed
            } else {
              logger.info({folder: currentPath}, 'Created folder');
            }

            // Create next part in sequence
            createNextPart(index + 1);
          });
        };

        // Start creating folders for this path
        createNextPart(0);
      });
    });

    imap.once('error', (err) => {
      logger.error({error: err.message}, 'IMAP connection error');
      reject(err);
    });

    imap.connect();
  });
}
export async function findFirstUIDOnDate(folder, dateString) {
  const imap = connect();
  return new Promise((resolve, reject) => {
    imap.once('ready', () => {
      imap.openBox(folder, true, err => {
        if (err) return reject(err);
        const criteria = dateString ? [['SINCE', new Date(dateString)]] : ['ALL'];
        logger.debug({folder, criteria}, 'Searching messages');
        imap.search(criteria, (err, results) => {
          if (err || !results.length) {
            logger.debug({folder}, 'No messages found');
            imap.end();
            return resolve(null);
          }
          const f = imap.fetch(results, { bodies: '', struct: true });
          f.on('message', msg => {
            msg.once('attributes', attrs => {
              const last_uid = attrs.uid;
              const last_seen_date = attrs.date.toISOString();
              const last_checked = new Date().toISOString();

              imap.end();
              resolve({
                last_uid,
                last_seen_date,
                last_checked
              });
            });
          });
        });
      });
    });
    imap.once('error', reject);
    imap.connect();
  });
}

/**
 * Helper function to handle message fetching common code
 * @param msg
 * @param callback
 */
function readMessage(msg, callback) {
  let raw = '';
  let uid;

  msg.on('body', stream => stream.on('data', chunk => raw += chunk.toString()));

  msg.once('attributes', attrs => {
    uid = attrs.uid;
    logger.debug({uid, flags: attrs.flags, date: attrs.date}, 'Message attributes');
  });

  msg.once('end', () => callback(raw, uid));
}

/**
 * Open folder and return the box object
 */
export function open(imap, folder, readOnly = false) {
  return new Promise((resolve, reject) => {
    imap.once('ready', () => {
      logger.debug({folder}, 'Opening folder');
      imap.openBox(folder, readOnly, (err, box) => {
        if (err) {
          logger.error({folder, error: err.message}, 'Failed to open folder');
          return reject(err);
        }
        logger.info({folder, messageCount: box.messages.total}, 'Opened folder');
        resolve(box);
      });
    });
    imap.once('error', reject);
    imap.connect();
  });
}

/**
 * Get message count from an opened folder box
 */
export function count(box) {
  return box.messages.total;
}

/**
 * Search for new messages in an opened folder
 */
export function search(imap, lastUID) {
  return new Promise((resolve, reject) => {
    const query = [['UID', `${lastUID + 1}:*`]];
    imap.search(query, (err, results) => {
      if (err || !results.length) {
        logger.info('No new messages found');
        resolve([]);
      } else {
        logger.info({foundMessages: results.length}, 'Found new messages');
        resolve(results);
      }
    });
  });
}

/**
 * for learnFromFolder: Fetch all messages sequentially
 */
export function fetchAllMessages(imap) {
  return new Promise((resolve, reject) => {
    const messages = [];
    const f = imap.seq.fetch('1:*', {bodies: ''});

    f.on('message', msg => {
      readMessage(msg, (raw, uid) => {
        messages.push({uid, raw});
      });
    });

    f.once('end', () => {
      logger.info({messageCount: messages.length}, 'Fetched all messages');
      resolve(messages);
    });

    f.once('error', reject);
  });
}

/**
 * for scanInbox: Fetch messages by UID with batch limit
 */
export function fetchMessagesByUID(imap, uids, batchSize) {
  return new Promise((resolve, reject) => {
    const messages = [];
    const limitedUIDs = uids.slice(0, batchSize);
    const f = imap.fetch(limitedUIDs, {bodies: ''});

    f.on('message', msg => {
      readMessage(msg, (raw, uid) => {
        messages.push({uid, raw});
      });
    });

    f.once('end', () => {
      logger.info({messageCount: messages.length}, 'Fetched messages by UID');
      resolve(messages);
    });

    f.once('error', reject);
  });
}

/**
 * Helper function to handle message moving and expunging
 */
export function moveMessage(imap, uid, dest) {
  return new Promise((resolve, reject) => {
    logger.debug({uid, destFolder: dest}, 'Moving message by UID');
    imap.move(uid, dest, (moveErr) => {
      if (moveErr) {
        logger.error({uid, destFolder: dest, error: moveErr.message}, 'Failed to move message by UID');
        return reject(moveErr);
      }

      logger.info({uid, destFolder: dest}, 'Successfully moved message by UID');

      // Expunge to ensure the move is committed
      logger.debug('Expunging to finalize the move operation');
      imap.expunge((expErr) => {
        if (expErr) {
          logger.error({error: expErr.message}, 'Failed to expunge after move');
          return reject(expErr);
        }

        logger.info({uid, destFolder: dest}, 'Move completed with expunge');
        resolve();
      });
    });
  });
}

/**
 * for both: Move all messages to destination folder
 */
export function moveMessages(imap, messages, destFolder) {
  return new Promise((resolve, reject) => {
    if (messages.length === 0) {
      return resolve();
    }

    let completedMoves = 0;
    let hasError = false;

    messages.forEach(({uid}) => {
      moveMessage(imap, uid, destFolder)
          .then(() => {
            completedMoves++;
            logger.info({uid, destFolder, completedMoves, total: messages.length}, 'Message moved');

            if (completedMoves === messages.length) {
              logger.info({movedCount: completedMoves, destFolder}, 'All messages moved');
              resolve();
            }
          })
          .catch((err) => {
            if (!hasError) {
              hasError = true;
              logger.error({uid, destFolder, error: err.message}, 'Failed to move message');
              reject(err);
            }
          });
    });
  });
}