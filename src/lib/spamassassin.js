import {getConfig} from './util.js';
import {readScannerState, writeScannerState} from './state-manager.js';
import Imap from 'imap';
import {simpleParser} from 'mailparser';
import {spawn} from 'child_process';
import {PassThrough} from 'stream';
import {connect} from "./imap-client.js";
import pino from 'pino';

const config = getConfig();
const logger = pino();

export async function scanInbox() {
  const imap = connect();

  const state = await readScannerState();
  return new Promise((resolve, reject) => {
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
            imap.end();
            return resolve();
          }
          const f = imap.fetch(results.slice(0, config.SCAN_BATCH_SIZE), { bodies: '' });
          let lastUID = state.last_uid;
          f.on('message', msg => {
            let raw = '';
            let uid;
            msg.on('body', stream => stream.on('data', chunk => raw += chunk.toString()));
            msg.once('attributes', attrs => {
              uid = attrs.uid;
              logger.debug({uid, flags: attrs.flags, date: attrs.date}, 'Message attributes');
            });
            msg.once('end', () => {
              const proc = spawn('spamc');
              const input = new PassThrough();
              proc.stdin.end(raw);
              let output = '';
              proc.stdout.on('data', chunk => output += chunk);
              proc.on('close', code => {
                if (output.includes('X-Spam-Flag: YES')) {
                  // Use move operation directly
                  logger.info({uid, folder: config.FOLDER_SPAM}, 'Detected spam, moving to spam folder');

                  imap.move(uid, config.FOLDER_SPAM, moveErr => {
                    if (moveErr) {
                      logger.error({uid, folder: config.FOLDER_SPAM, error: moveErr.message}, 'Failed to move spam message');
                    } else {
                      logger.info({uid, folder: config.FOLDER_SPAM}, 'Successfully moved spam message');

                      // Expunge to ensure the move is committed
                      imap.expunge(expErr => {
                        if (expErr) {
                          logger.error({error: expErr.message}, 'Failed to expunge after spam move');
                        } else {
                          logger.info({uid, folder: config.FOLDER_SPAM}, 'Spam move completed with expunge');
                        }
                      });
                    }
                  });
                }
                lastUID = Math.max(lastUID, uid);
              });
            });
          });
          f.once('end', () => {
            logger.info('Fetch completed, waiting for operations to finish');

            // Use a timeout to ensure all operations have time to complete
            setTimeout(() => {
              logger.info('Ending IMAP connection and writing scanner state');
              imap.end();
              writeScannerState({
                last_uid: lastUID,
                last_seen_date: new Date().toISOString(),
                last_checked: new Date().toISOString()
              }).then(resolve);
            }, 5000); // Wait 5 seconds before closing connection
          });
        });
      });
    });
    imap.once('error', reject);
    imap.connect();
  });
}

export async function learnFromFolder(type) {
  const folder = type === 'spam' ? config.FOLDER_TRAIN_SPAM : config.FOLDER_TRAIN_HAM;
  const learnCmd = type === 'spam' ? '--spam' : '--ham';
  const destFolder = type === 'spam' ? config.FOLDER_SPAM : config.FOLDER_INBOX;

  const imap = new Imap({
    user: config.IMAP_USER,
    password: config.IMAP_PASSWORD,
    host: config.IMAP_HOST,
    port: config.IMAP_PORT,
    tls: config.IMAP_TLS
  });

  return new Promise((resolve, reject) => {
    imap.once('ready', () => {
      logger.info({folder, type}, 'Opening folder for learning');
      logger.debug({folder, user: config.IMAP_USER, host: config.IMAP_HOST}, 'IMAP connection details');
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
        f.on('message', msg => {
          let raw = '';
          let uid;
          msg.on('body', stream => stream.on('data', chunk => raw += chunk.toString()));
          msg.once('attributes', attrs => {
            uid = attrs.uid;
            logger.debug({uid, flags: attrs.flags, date: attrs.date}, 'Message attributes');
          });
          msg.once('end', () => {
            logger.info({uid, type}, 'Learning message');
            const proc = spawn('sa-learn', [learnCmd]);
            proc.stdin.write(raw);
            proc.stdin.end();
            proc.on('close', () => {
              logger.info({uid, destFolder}, 'Moving learned message');

              // Only use UID-based operations for consistency
              logger.debug({uid, destFolder}, 'Moving message by UID');
              imap.move(uid, destFolder, (moveErr) => {
                if (moveErr) {
                  logger.error({uid, destFolder, error: moveErr.message}, 'Failed to move message by UID');
                } else {
                  logger.info({uid, destFolder}, 'Successfully moved message by UID');

                  // Expunge to ensure the move is committed
                  logger.debug('Expunging to finalize the move operation');
                  imap.expunge((expErr) => {
                    if (expErr) {
                      logger.error({error: expErr.message}, 'Failed to expunge after move');
                    } else {
                      logger.info({uid, destFolder}, 'Move completed with expunge');
                    }
                  });
                }
              });
            });
          });
        });
        f.once('end', () => {
          logger.info({folder}, 'Completed processing all messages in folder');

          // Give some time for move operations to complete
          setTimeout(() => {
            logger.info({folder, type}, 'Finishing up and closing connection');
            imap.end();
            resolve();
          }, 5000); // Wait 5 seconds before closing the connection
        });
      });
    });
    imap.once('error', reject);
    imap.connect();
  });
}