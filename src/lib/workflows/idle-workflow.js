import {rootLogger} from '../utils/logger.js';
import {config} from '../utils/config.js';

const logger = rootLogger.forComponent('idle-workflow');

/**
 * Run IMAP IDLE workflow
 * Registers exists/error listeners before acquiring the lock (to avoid any
 * race between lock acquisition and listener attachment), then opens a
 * read-only mailbox lock on FOLDER_INBOX and immediately enters IDLE.
 * Resolves when the server sends an EXISTS notification (new message arrived).
 * Rejects if the connection emits an error while waiting.
 * Releases the lock and cleans up listeners in a finally block.
 * @param {Object} imap - ImapFlow client
 * @returns {Promise<void>}
 */
export async function runIdle(imap) {
  let onExists, onError;

  // Register listeners before acquiring the lock so no notification is missed
  // between the lock being granted and the listener being attached.
  const existsPromise = new Promise((resolve, reject) => {
    onExists = (data) => {
      logger.debug({folder: config.FOLDER_INBOX, data}, 'EXISTS notification received');
      resolve();
    };
    onError = (err) => {
      logger.debug({folder: config.FOLDER_INBOX, error: err.message}, 'Connection error while waiting for EXISTS');
      reject(err);
    };
    imap.once('exists', onExists);
    imap.once('error', onError);
  });

  let lock;
  try {
    lock = await imap.getMailboxLock(config.FOLDER_INBOX, {readOnly: true});
  } catch (err) {
    // Lock acquisition failed — clean up listeners so they don't fire later.
    imap.off('exists', onExists);
    imap.off('error', onError);
    throw err;
  }

  try {
    logger.debug({folder: config.FOLDER_INBOX, exists: imap.mailbox.exists}, 'Watching for new messages');
    // Immediately enter IDLE without waiting for the 15-second autoidle delay.
    // Errors here are expected when IDLE is interrupted (e.g. lock released).
    imap.idle().catch((err) => logger.debug({folder: config.FOLDER_INBOX, error: err.message}, 'IDLE ended'));
    // Wait here until the server sends an EXISTS notification or the connection errors.
    await existsPromise;
    logger.debug({folder: config.FOLDER_INBOX}, 'IDLE resolved');
  } finally {
    imap.off('exists', onExists);
    imap.off('error', onError);
    lock.release();
  }
}
