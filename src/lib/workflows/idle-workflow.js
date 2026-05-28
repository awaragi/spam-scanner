import {rootLogger} from '../utils/logger.js';
import {config} from '../utils/config.js';

const logger = rootLogger.forComponent('idle-workflow');

/**
 * Run IMAP IDLE workflow
 * Registers an exists listener, opens a mailbox lock on FOLDER_INBOX in
 * read-only mode, and waits. ImapFlow auto-enters IDLE after inactivity
 * (maxIdleTime cycles it every 29 minutes). Resolves when the server sends
 * an EXISTS notification (new message arrived). Releases the lock in a
 * finally block.
 * @param {Object} imap - ImapFlow client
 * @returns {Promise<void>}
 */
export async function runIdle(imap) {
  // Register the exists listener before acquiring the lock so no notification
  // is missed between the lock being granted and the listener being attached.
  const existsPromise = new Promise((resolve) => {
    imap.once('exists', (data) => {
      logger.debug({folder: config.FOLDER_INBOX, data}, 'EXISTS notification received');
      resolve();
    });
  });

  const lock = await imap.getMailboxLock(config.FOLDER_INBOX, {readOnly: true});
  try {
    logger.debug({folder: config.FOLDER_INBOX, exists: imap.mailbox.exists}, 'Watching for new messages');
    // Immediately enter IDLE without waiting for the 15-second autoidle delay.
    imap.idle().catch(() => {});
    // Wait here until the server sends an EXISTS notification.
    await existsPromise;
    logger.debug({folder: config.FOLDER_INBOX}, 'IDLE resolved');
  } finally {
    lock.release();
  }
}
