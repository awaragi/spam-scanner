import {getConfig} from './util.js';
import {readScannerState, writeScannerState} from './state-manager.js';
import {spawn} from 'child_process';
import {connect} from "./imap-client.js";
import pino from 'pino';

const config = getConfig();
const logger = pino();

const POLL_INTERVAL_MS = 1000;

function waitForPendingOperations(imap, pendingOperationsFn, onComplete) {
  const checkInterval = setInterval(() => {
    let pendingOperations = pendingOperationsFn();
    logger.info({pendingOperations}, 'Pending operations before completeness');
    if (pendingOperations <= 0) {
      clearInterval(checkInterval);
      imap.end();
      onComplete();
    }
  }, POLL_INTERVAL_MS);
}

// Helper function to handle message moving and expunging
function moveMessage(imap, uid, destFolder) {
  return new Promise((resolve, reject) => {
    logger.debug({uid, destFolder}, 'Moving message by UID');
    imap.move(uid, destFolder, (moveErr) => {
      if (moveErr) {
        logger.error({uid, destFolder, error: moveErr.message}, 'Failed to move message by UID');
        return reject(moveErr);
      }

      logger.info({uid, destFolder}, 'Successfully moved message by UID');

      // Expunge to ensure the move is committed
      logger.debug('Expunging to finalize the move operation');
      imap.expunge((expErr) => {
        if (expErr) {
          logger.error({error: expErr.message}, 'Failed to expunge after move');
          return reject(expErr);
        }

        logger.info({uid, destFolder}, 'Move completed with expunge');
        resolve();
      });
    });
  });
}

/**
 * Node.js IMAP connection pattern:
 * 1. Create an IMAP object
 * 2. Set up all event handlers (ready, error, etc.)
 * 3. Call connect() to initiate the connection
 * 4. Once ready, perform operations
 * 5. Call end() when done to close the connection
 */

// Helper function to handle message fetching common code
function setupMessageHandlers(msg, callback) {
  let raw = '';
  let uid;

  msg.on('body', stream => stream.on('data', chunk => raw += chunk.toString()));

  msg.once('attributes', attrs => {
    uid = attrs.uid;
    logger.debug({uid, flags: attrs.flags, date: attrs.date}, 'Message attributes');
  });

  msg.once('end', () => callback(raw, uid));
}

export async function scanInbox() {
  const state = await readScannerState();
  const imap = connect();

  return new Promise((resolve, reject) => {
    // Set up event handlers before initiating the connection
    imap.once('ready', () => {
      logger.debug({folder: config.FOLDER_INBOX}, 'Opening inbox for scanning');
      imap.openBox(config.FOLDER_INBOX, false, (err, box) => {
        if (err) {
          logger.error({folder: config.FOLDER_INBOX, error: err.message}, 'Failed to open inbox');
          return reject(err);
        }

        logger.info({folder: config.FOLDER_INBOX, messageCount: box.messages.total}, 'Opened inbox for scanning');
        const query = [['UID', `${state.last_uid + 1}:*`]];
        imap.search(query, (err, results) => {
          if (err || results.length === 0) {
            logger.error({folder: config.FOLDER_INBOX, error: err.message}, 'No messages found');
            imap.end();
            return resolve();
          }

          const f = imap.fetch(results.slice(0, config.SCAN_BATCH_SIZE), { bodies: '' });
          let lastUID = state.last_uid;
          let pendingOperations = 0;

          f.on('message', msg => {
            logger.info({pendingOperations, uid: msg.uid, }, 'Starting new message processing');

            pendingOperations++;

            setupMessageHandlers(msg, async (raw, uid) => {
              logger.info({uid}, 'Starting SpamAssassin check');
              const proc = spawn('spamc');
              proc.stdin.end(raw);
              let output = '';
              proc.stdout.on('data', chunk => output += chunk);

              proc.on('close', async code => {
                logger.info({uid, code}, 'SpamAssassin check completed');
                if (code !== 0) {
                  logger.error({uid, code}, 'SpamAssassin process failed');
                }
                if (output.includes('X-Spam-Flag: YES')) {
                  logger.info({uid, folder: config.FOLDER_SPAM}, 'Detected spam, moving to spam folder');
                  try {
                    await moveMessage(imap, uid, config.FOLDER_SPAM);
                  } catch (err) {
                    // Error already logged in moveMessage
                  }
                }

                lastUID = Math.max(lastUID, uid);
                pendingOperations--;
              });
            });
          });

          f.once('end', () => {
            // Poll for pending operations to complete before closing
            waitForPendingOperations(imap, () => pendingOperations, () => {
              writeScannerState({
                last_uid: lastUID,
                last_seen_date: new Date().toISOString(),
                last_checked: new Date().toISOString()
              }).then(resolve);
            });
          });
        });
      });
    });

    imap.once('error', reject);
    // Initiate the IMAP connection after all event handlers are set up
    imap.connect();
  });
}

export async function learnFromFolder(type) {
  const folder = type === 'spam' ? config.FOLDER_TRAIN_SPAM : config.FOLDER_TRAIN_HAM;
  const learnCmd = type === 'spam' ? '--spam' : '--ham';
  const destFolder = type === 'spam' ? config.FOLDER_SPAM : config.FOLDER_INBOX;

  const imap = connect();

  return new Promise((resolve, reject) => {
    imap.once('ready', () => {
      logger.info({folder, type}, 'Opening folder for learning');
      imap.openBox(folder, false, (err, box) => {
        if (err) {
          logger.error({folder, error: err.message}, 'Failed to open folder');
          imap.end();
          return reject(err);
        }

        logger.info({folder, messageCount: box.messages.total}, 'Opened folder for processing');

        // Check if folder is empty
        if (box.messages.total === 0) {
          logger.info({folder}, 'No messages in folder to process');
          imap.end();
          return resolve();
        }

        const f = imap.seq.fetch('1:*', { bodies: '' });
        let pendingOperations = 0;

        f.on('message', msg => {
          pendingOperations++;

          setupMessageHandlers(msg, async (raw, uid) => {
            logger.info({uid, type}, 'Learning message');
            const proc = spawn('sa-learn', [learnCmd]);
            proc.stdin.write(raw);
            proc.stdin.end();

            proc.on('close', async () => {
              logger.info({uid, destFolder}, 'Moving learned message');

              try {
                await moveMessage(imap, uid, destFolder);
              } catch (err) {
                // Error already logged in moveMessage
              } finally {
                pendingOperations--;
              }
            });
          });
        });

        f.once('end', () => {
          logger.info({folder}, 'Completed processing all messages in folder');

          // Poll for pending operations to complete before closing
          waitForPendingOperations(imap, () => pendingOperations, () => {
            logger.info({folder, type}, 'All operations completed, closing connection');
            resolve();
          });
        });
      });
    });

    imap.once('error', reject);
    // Initiate the IMAP connection after all event handlers are set up
    imap.connect();
  });
}