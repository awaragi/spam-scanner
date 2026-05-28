import {rootLogger} from '../utils/logger.js';
import {config} from '../utils/config.js';

const logger = rootLogger.forComponent('idle-workflow');

/**
 * Run IMAP IDLE workflow
 * Opens a mailbox lock on FOLDER_INBOX in read-only mode, enters IDLE, and
 * resolves when the server sends an EXISTS notification (new message arrived).
 * Releases the lock in a finally block on both success and error.
 * @param {Object} imap - ImapFlow client
 * @returns {Promise<void>}
 */
export async function runIdle(imap) {
  const lock = await imap.getMailboxLock(config.FOLDER_INBOX, {readOnly: true});
  try {
    logger.debug({folder: config.FOLDER_INBOX, exists: imap.mailbox.exists}, 'Entering IDLE, waiting for EXISTS notification');

    const idleTimeoutMs = 29 * 60 * 1000;

    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        logger.debug({folder: config.FOLDER_INBOX}, 'IDLE timeout reached, cycling');
        imap.off('exists', onExists);
        resolve();
      }, idleTimeoutMs);

      function onExists(data) {
        logger.debug({folder: config.FOLDER_INBOX, data}, 'EXISTS notification received');
        clearTimeout(timer);
        imap.off('exists', onExists);
        resolve();
      }

      imap.on('exists', onExists);

      // Actually send the IDLE command to the server (required because disableAutoIdle is true)
      imap.idle().catch((err) => {
        logger.debug({folder: config.FOLDER_INBOX, error: err.message}, 'IDLE command ended');
        clearTimeout(timer);
        imap.off('exists', onExists);
        resolve();
      });
    });

    logger.debug({folder: config.FOLDER_INBOX}, 'IDLE resolved');
  } finally {
    lock.release();
  }
}
