import { ImapFlow } from 'imapflow';
import type { MailboxObject, ExistsEvent } from 'imapflow';
import { setTimeout as delay } from 'timers/promises';
import type { Logger as PinoLogger } from 'pino';

/**
 * Watches a mailbox folder for new mail via IMAP IDLE.
 *
 * Establishes a read-only lock on the folder and enters IDLE mode to wait for
 * incoming mail. Resolves when one of the following occurs:
 * - An EXISTS notification (new mail arrived after the lock was acquired)
 * - The connection errors or closes
 * - The caller's abort signal is triggered
 * - The watchdog timer elapses (if enabled)
 *
 * The pre-IDLE catch-up is important: between the last scan (a separate
 * connection) and now, mail may have arrived. The mailbox SELECT behind
 * getMailboxLock reflects those arrivals, but IDLE only reports EXISTS for
 * mail arriving after the lock is acquired. Without this check, already-arrived
 * mail would sit unprocessed until the next unrelated EXISTS event. If
 * `lastUid` is provided and mail already exists between that UID and the
 * current uidNext, the function returns immediately without entering IDLE.
 *
 * @param imap - A connected ImapFlow instance
 * @param folder - The mailbox folder to watch (e.g., "INBOX")
 * @param options - Optional configuration
 *   - `signal`: AbortSignal to cancel the wait early
 *   - `lastUid`: The highest UID processed in the previous scan; used to
 *     detect mail already present before IDLE starts
 *   - `watchdogMs`: Watchdog timer duration in milliseconds. Defaults to
 *     1200000 (20 minutes). Set to 0 to disable. When enabled, IDLE is
 *     recycled after this duration to keep the connection fresh.
 *   - `logger`: Optional pino logger for debug logging
 * @throws Rejects if the connection errors, closes, or the lock acquisition fails
 */
export async function waitForNewMail(
  imap: ImapFlow,
  folder: string,
  {
    signal,
    lastUid,
    watchdogMs = 1200000, // 20 minutes, matching terminal's default IDLE_WATCHDOG_MS
    logger,
  }: {
    signal?: AbortSignal;
    lastUid?: number;
    watchdogMs?: number;
    logger?: PinoLogger;
  } = {}
): Promise<void> {
  let onExists: (data: ExistsEvent) => void;
  let onError: (err: Error) => void;
  let onClose: () => void;
  let onAbort: () => void;

  // Register listeners before acquiring the lock so no notification is missed
  // between the lock being granted and the listener being attached.
  const existsPromise = new Promise<void>((resolve, reject) => {
    onExists = data => {
      logger?.debug({ folder, data }, 'EXISTS notification received');
      resolve();
    };
    onError = err => {
      logger?.debug(
        { folder, error: err.message },
        'Connection error while waiting for EXISTS'
      );
      reject(err);
    };
    onClose = () => {
      logger?.debug({ folder }, 'Connection closed while waiting for EXISTS');
      reject(new Error('IMAP connection closed while waiting for EXISTS'));
    };
    onAbort = () => {
      logger?.debug({ folder }, 'IDLE aborted by caller');
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

  function cleanupListeners(): void {
    imap.off('exists', onExists);
    imap.off('error', onError);
    imap.off('close', onClose);
    if (signal) signal.removeEventListener('abort', onAbort);
  }

  let lock;
  try {
    lock = await imap.getMailboxLock(folder, { readOnly: true });
  } catch (err) {
    // Lock acquisition failed — clean up listeners so they don't fire later.
    cleanupListeners();
    throw err;
  }

  // Cancels the watchdog timer as soon as we stop waiting for any other reason.
  const watchdogController = new AbortController();

  try {
    if (signal?.aborted) {
      logger?.debug({ folder }, 'IDLE skipped - already aborted');
      return;
    }

    // getMailboxLock above has already SELECTed the mailbox, so `imap.mailbox`
    // is a real MailboxObject here, not the `false` idle state imapflow's own
    // type also allows.
    const mailbox = imap.mailbox as MailboxObject;

    // Pre-IDLE catch-up: the mailbox SELECT behind getMailboxLock already
    // reflects any mail that arrived between the last scan (a separate
    // connection) and now. IDLE only reports EXISTS for mail arriving after
    // this point, so without this check that already-arrived mail would sit
    // unprocessed until the next unrelated EXISTS event.
    if (
      typeof lastUid === 'number' &&
      typeof mailbox?.uidNext === 'number' &&
      mailbox.uidNext - 1 > lastUid
    ) {
      logger?.debug(
        { folder, lastUid, uidNext: mailbox.uidNext },
        'New mail already present before IDLE - skipping wait'
      );
      return;
    }

    logger?.debug(
      { folder, exists: mailbox.exists },
      'Watching for new messages'
    );
    // Immediately enter IDLE without waiting for the 15-second autoidle delay.
    // Errors here are expected when IDLE is interrupted (e.g. lock released).
    imap
      .idle()
      .catch(err =>
        logger?.debug(
          { folder, error: err instanceof Error ? err.message : String(err) },
          'IDLE ended'
        )
      );

    const racers: Promise<void>[] = [existsPromise];
    if (watchdogMs > 0) {
      racers.push(
        delay(watchdogMs, undefined, { signal: watchdogController.signal })
          .then(() =>
            logger?.debug(
              { folder, watchdogMs },
              'IDLE watchdog elapsed - recycling'
            )
          )
          .catch((err: Error) => {
            if (err.name !== 'AbortError') throw err;
          })
      );
    }
    // Wait here until the server sends an EXISTS notification, the connection
    // errors/closes, the caller aborts, or the watchdog elapses.
    await Promise.race(racers);
    logger?.debug({ folder }, 'IDLE resolved');
  } finally {
    watchdogController.abort();
    cleanupListeners();
    lock.release();
  }
}
