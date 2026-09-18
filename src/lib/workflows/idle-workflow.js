import { setTimeout as delay } from 'timers/promises';
import { rootLogger } from '../utils/logger.js';
import { config } from '../utils/config.js';

const logger = rootLogger.forComponent('idle-workflow');

/**
 * Run IMAP IDLE workflow
 * Registers exists/error/close listeners before acquiring the lock (to avoid
 * any race between lock acquisition and listener attachment), then opens a
 * read-only mailbox lock on FOLDER_INBOX.
 *
 * Before entering IDLE, compares the freshly-selected mailbox's UIDNEXT
 * against `lastUid` (the caller's last processed UID): if mail already
 * arrived between the last scan and this call, returns immediately instead
 * of waiting for a new EXISTS notification that may not come for hours.
 *
 * Otherwise enters IDLE and resolves on whichever happens first:
 *   - an EXISTS notification (new message arrived)
 *   - `watchdogMs` elapses with no notification (silent disconnect
 *     guard - also causes the orchestrator to re-poll training folders,
 *     which IDLE itself does not watch)
 *   - `signal` is aborted (caller-requested shutdown)
 * Rejects if the connection emits `error` or `close` while waiting.
 * Releases the lock and cleans up listeners/timers in a finally block.
 * @param {Object} imap - ImapFlow client
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal] - Aborting resolves the wait immediately (treated as a wakeup, not an error)
 * @param {number} [options.lastUid] - Last UID processed by the scanner; used for the pre-IDLE catch-up check
 * @param {number} [options.watchdogMs] - Max time to stay in IDLE before recycling regardless of activity; 0 disables it
 * @returns {Promise<void>}
 */
export async function runIdle(
  imap,
  { signal, lastUid, watchdogMs = config.IDLE_WATCHDOG_MS } = {}
) {
  let onExists, onError, onClose, onAbort;

  // Register listeners before acquiring the lock so no notification is missed
  // between the lock being granted and the listener being attached.
  const existsPromise = new Promise((resolve, reject) => {
    onExists = data => {
      logger.debug(
        { folder: config.FOLDER_INBOX, data },
        'EXISTS notification received'
      );
      resolve();
    };
    onError = err => {
      logger.debug(
        { folder: config.FOLDER_INBOX, error: err.message },
        'Connection error while waiting for EXISTS'
      );
      reject(err);
    };
    onClose = () => {
      logger.debug(
        { folder: config.FOLDER_INBOX },
        'Connection closed while waiting for EXISTS'
      );
      reject(new Error('IMAP connection closed while waiting for EXISTS'));
    };
    onAbort = () => {
      logger.debug({ folder: config.FOLDER_INBOX }, 'IDLE aborted by caller');
      resolve();
    };
    imap.once('exists', onExists);
    imap.once('error', onError);
    imap.once('close', onClose);
    if (signal) {
      if (signal.aborted) {
        onAbort();
      } else {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }
  });

  function cleanupListeners() {
    imap.off('exists', onExists);
    imap.off('error', onError);
    imap.off('close', onClose);
    if (signal) signal.removeEventListener('abort', onAbort);
  }

  let lock;
  try {
    lock = await imap.getMailboxLock(config.FOLDER_INBOX, {
      readOnly: true,
    });
  } catch (err) {
    // Lock acquisition failed — clean up listeners so they don't fire later.
    cleanupListeners();
    throw err;
  }

  // Cancels the watchdog timer as soon as we stop waiting for any other reason.
  const watchdogController = new AbortController();

  try {
    if (signal?.aborted) {
      logger.debug(
        { folder: config.FOLDER_INBOX },
        'IDLE skipped - already aborted'
      );
      return;
    }

    // Pre-IDLE catch-up: the mailbox SELECT behind getMailboxLock already
    // reflects any mail that arrived between the last scan (a separate
    // connection) and now. IDLE only reports EXISTS for mail arriving after
    // this point, so without this check that already-arrived mail would sit
    // unprocessed until the next unrelated EXISTS event.
    if (
      typeof lastUid === 'number' &&
      typeof imap.mailbox?.uidNext === 'number' &&
      imap.mailbox.uidNext - 1 > lastUid
    ) {
      logger.debug(
        { folder: config.FOLDER_INBOX, lastUid, uidNext: imap.mailbox.uidNext },
        'New mail already present before IDLE - skipping wait'
      );
      return;
    }

    logger.debug(
      { folder: config.FOLDER_INBOX, exists: imap.mailbox.exists },
      'Watching for new messages'
    );
    // Immediately enter IDLE without waiting for the 15-second autoidle delay.
    // Errors here are expected when IDLE is interrupted (e.g. lock released).
    imap
      .idle()
      .catch(err =>
        logger.debug(
          { folder: config.FOLDER_INBOX, error: err.message },
          'IDLE ended'
        )
      );

    const racers = [existsPromise];
    if (watchdogMs > 0) {
      racers.push(
        delay(watchdogMs, undefined, { signal: watchdogController.signal })
          .then(() =>
            logger.debug(
              { folder: config.FOLDER_INBOX, watchdogMs },
              'IDLE watchdog elapsed - recycling'
            )
          )
          .catch(err => {
            if (err.name !== 'AbortError') throw err;
          })
      );
    }
    // Wait here until the server sends an EXISTS notification, the connection
    // errors/closes, the caller aborts, or the watchdog elapses.
    await Promise.race(racers);
    logger.debug({ folder: config.FOLDER_INBOX }, 'IDLE resolved');
  } finally {
    watchdogController.abort();
    cleanupListeners();
    lock.release();
  }
}
