import { ImapFlow } from 'imapflow';
import { setTimeout as delay } from 'timers/promises';
import { config } from '../core/config.js';
import { rootLogger } from '../core/logger.js';
import { parseEmail, stripSpamHeaders } from '../utils/email-parser.util.js';
import { collectFoldersToCreate } from '../utils/mailboxes.util.js';

const logger = rootLogger.forComponent('imap');

export function newClient() {
  const imapflowLogger = rootLogger.forComponent('imapflow');

  return new ImapFlow({
    host: config.IMAP_HOST,
    port: config.IMAP_PORT,
    secure: config.IMAP_TLS === true,
    // Only set when secure=false (secure=true + doSTARTTLS=true is invalid):
    // without this, ImapFlow attempts STARTTLS opportunistically and silently
    // continues in plaintext if it's unavailable - a downgrade-attack risk.
    // See the `imap-transport-security` capability.
    doSTARTTLS: config.IMAP_TLS ? undefined : true,
    auth: {
      user: config.IMAP_USER,
      pass: config.IMAP_PASSWORD,
    },
    logger: {
      debug: imapflowLogger.debug.bind(imapflowLogger),
      info: imapflowLogger.debug.bind(imapflowLogger), // Redirect info to debug
      warn: imapflowLogger.warn.bind(imapflowLogger),
      error: imapflowLogger.error.bind(imapflowLogger),
      fatal: imapflowLogger.fatal.bind(imapflowLogger),
      trace: imapflowLogger.trace.bind(imapflowLogger),
    },
    emitLogs: false,
    maxIdleTime: 29 * 60 * 1000,
  });
}

/**
 * Logs out an ImapFlow client, swallowing any error - safe to call in a
 * `finally` block even when `connect()` itself never succeeded (there's
 * nothing to log out of in that case, and letting that error escape would
 * mask whatever error the caller already handled).
 * @param {ImapFlow} imap
 * @returns {Promise<void>}
 */
export async function safeLogout(imap) {
  try {
    await imap.logout();
  } catch (err) {
    logger.debug(
      { error: err.message },
      'Logout failed (connection likely never established)'
    );
  }
}

/**
 * Retrieves the IMAP folder hierarchy delimiter.
 * @param {ImapFlow} imap - An active and connected ImapFlow client instance.
 * @returns {Promise<string|null>} The folder delimiter (e.g., "/", "."), or null if not found.
 */
export async function getImapDelimiter(imap) {
  const mailboxes = await imap.list();
  for (const mailbox of mailboxes) {
    if (mailbox.delimiter) {
      return mailbox.delimiter;
    }
  }
  return null;
}

export async function createAppFolders(imap, folders) {
  if (folders.length === 0) {
    return;
  }

  // Get the folder separator character
  const separator = await getImapDelimiter(imap);
  if (!separator) {
    throw new Error('Failed to get folder separator');
  }
  // First collect and order all folder paths that need to be created
  const foldersToCreate = collectFoldersToCreate(folders, separator);

  // Now attempt to create the folders in order
  for (const folderPath of foldersToCreate) {
    logger.debug({ folder: folderPath }, `Ensuring existence of folder`);
    const res = await imap.mailboxCreate(folderPath);
    if (res.created === false) {
      logger.debug({ folder: folderPath }, 'Folder exists');
    } else {
      logger.info({ folder: folderPath }, 'Created folder');
    }
  }
}
export async function findFirstUIDOnDate(imap, folder, dateString) {
  try {
    // Open the mailbox in read-only mode
    await imap.mailboxOpen(folder, { readOnly: true });

    // Prepare search criteria
    const criteria = dateString ? { since: new Date(dateString) } : {};
    logger.debug({ folder, criteria }, 'Searching messages');

    // Search for messages
    const results = await imap.search(criteria);

    if (!results.length) {
      logger.debug({ folder }, 'No messages found');
      return null;
    }

    // Get the first message
    const message = await imap.fetchOne(results[0], { envelope: true });

    if (!message) {
      logger.debug({ folder }, 'Failed to fetch message');
      return null;
    }

    const last_uid = message.uid;
    const last_seen_date = message.envelope.date.toISOString();
    const last_checked = new Date().toISOString();

    return {
      last_uid,
      last_seen_date,
      last_checked,
    };
  } catch (err) {
    logger.error({ folder, error: err.message }, 'Error in findFirstUIDOnDate');
    throw err;
  }
}

/**
 * Helper function to handle message fetching common code
 * @param {Object} message - The message object from ImapFlow
 * @returns {Object} - Object containing raw message, uid, and attributes
 */
export function processMessage(message) {
  const { uid, flags, envelope } = message;
  const messageLogger = logger.forMessage(uid);
  // ImapFlow returns a Buffer for message.source
  const raw = stripSpamHeaders(message.source.toString());
  const { body, headers } = parseEmail(raw);

  messageLogger.debug('Message read');

  return {
    uid,
    flags,
    envelope,
    raw,
    headers,
    body,
  };
}

/**
 * Helper function to handle headers-only message fetching - for callers (map
 * training) that only need `uid`/`headers`, never the source or body, so a
 * much cheaper `BODY[HEADER]` fetch suffices instead of a full `BODY[]` one.
 * `parseEmail` splits on the first blank line it finds to separate headers
 * from body; a headers-only fetch has no body and so may have no trailing
 * blank line, so one is appended here - a no-op if the fetched header block
 * already ends in one, and otherwise what makes `parseEmail` find the
 * boundary at all rather than treating the whole buffer as bodyless content.
 * @param {Object} message - The message object from ImapFlow (fetched with `headers: true`)
 * @returns {{uid: number, headers: Record<string, string>}}
 */
export function processMessageHeaders(message) {
  const { uid, headers: headerBuffer } = message;
  const messageLogger = logger.forMessage(uid);
  const { headers } = parseEmail(`${headerBuffer.toString()}\r\n\r\n`);

  messageLogger.debug('Message headers read');

  return { uid, headers };
}

/**
 * Open folder and return the box object
 */
export async function open(imap, folder, readOnly = false) {
  try {
    // Check if the client is already connected
    if (!imap.usable) {
      await imap.connect();
    }

    logger.debug({ folder }, 'Opening folder');
    const mailbox = await imap.mailboxOpen(folder, { readOnly });

    logger.debug({ folder, messageCount: mailbox.exists }, 'Opened folder');
    return mailbox;
  } catch (err) {
    logger.error({ folder, error: err.message }, 'Failed to open folder');
    throw err;
  }
}

/**
 * Get message count from an opened folder box
 */
export function count(box) {
  return box.exists;
}

/**
 * Search for messages in an opened folder based on query
 * @param {Object} imap - ImapFlow client
 * @param {Array|Object} query - Search query (array for node-imap compatibility, object for ImapFlow)
 * @returns {Promise<Array>} - Array of message UIDs
 */
export async function search(imap, query) {
  try {
    // Convert node-imap style query to ImapFlow style if needed
    logger.debug({ query: query }, 'Searching messages');
    const results = await imap.search(query, { uid: true });

    if (!results.length) {
      logger.debug({ query }, 'No messages found');
      return [];
    } else {
      logger.debug({ query, total: results.length }, 'Found messages');
      return results;
    }
  } catch (err) {
    logger.error({ query, error: err.message }, 'Error searching messages');
    throw err;
  }
}

/**
 * Fetch messages by UID
 * @param {Object} imap - ImapFlow client
 * @param {Array} uids - Array of UIDs to fetch
 * @returns {Promise<Array>} - Array of message objects with uid, raw content, and attributes
 */
export async function fetchMessagesByUIDs(imap, uids) {
  try {
    const messages = [];
    // Convert uids to a comma-separated string if it's an array
    const _messages = imap.fetch(
      { uid: uids.join(',') },
      {
        uid: true,
        source: true,
        envelope: true,
        bodyStructure: true,
        flags: true,
      },
      { uid: true }
    );

    for await (const message of _messages) {
      messages.push(processMessage(message));
    }

    logger.debug(
      { uids, messageCount: messages.length },
      'Fetched messages by UIDs'
    );
    return messages;
  } catch (err) {
    logger.error(
      { error: err.message, uids },
      'Error fetching messages by UIDs'
    );
    throw err;
  }
}

/**
 * Fetch only message headers by UID - see `processMessageHeaders` for why
 * this exists as a separate, cheaper primitive from `fetchMessagesByUIDs`.
 * @param {Object} imap - ImapFlow client
 * @param {Array} uids - Array of UIDs to fetch
 * @returns {Promise<Array>} - Array of `{uid, headers}` objects
 */
export async function fetchMessageHeadersByUIDs(imap, uids) {
  try {
    const messages = [];
    const _messages = imap.fetch(
      { uid: uids.join(',') },
      { uid: true, headers: true },
      { uid: true }
    );

    for await (const message of _messages) {
      messages.push(processMessageHeaders(message));
    }

    logger.debug(
      { uids, messageCount: messages.length },
      'Fetched message headers by UIDs'
    );
    return messages;
  } catch (err) {
    logger.error(
      { error: err.message, uids },
      'Error fetching message headers by UIDs'
    );
    throw err;
  }
}

/**
 * Helper function to handle message moving and expunging
 * @param {Object} imap - ImapFlow client
 * @param {Number} uid - UID of the message to move
 * @param {String} dest - Destination folder
 * @returns {Promise<void>}
 */
export async function moveMessage(imap, uid, dest) {
  const messageLogger = logger.forMessage(uid);
  try {
    messageLogger.debug({ destFolder: dest }, 'Moving message by UID');

    // Move the message
    await imap.messageMove({ uid }, dest);
    messageLogger.debug(
      { destFolder: dest },
      'Successfully moved message by UID'
    );

    // Expunge to ensure the move is committed
    logger.debug('Expunging to finalize the move operation');
    await imap.mailboxExpunge();

    messageLogger.debug({ destFolder: dest }, 'Move completed with expunge');
  } catch (err) {
    messageLogger.error(
      { destFolder: dest, error: err.message },
      'Failed to move message by UID'
    );
    throw err;
  }
}

/**
 * Move all messages to destination folder
 * @param {Object} imap - ImapFlow client
 * @param {Array} messages - Array of message objects with UIDs
 * @param {String} destFolder - Destination folder
 * @returns {Promise<void>}
 */
export async function moveMessages(imap, messages, destFolder) {
  if (messages.length === 0) {
    return;
  }

  try {
    // Extract UIDs from messages
    const uids = messages.map(message => message.uid);
    logger.debug({ uids, destFolder }, 'Moving messages');

    // Move all messages at once
    await imap.messageMove(uids, destFolder, { uid: true });

    logger.debug({ total: messages.length, destFolder }, 'All messages moved');
  } catch (err) {
    logger.error({ destFolder, error: err.message }, 'Failed to move messages');
    throw err;
  }
}

/**
 * Append a raw RFC822 message to a folder.
 * @param {Object} imap - ImapFlow client
 * @param {String} folder - Destination folder
 * @param {String} raw - Raw RFC822 message source
 * @param {Array} flags - IMAP flags to set on append (e.g. ['\\Seen']); omit to leave the message unread
 * @returns {Promise<void>}
 */
export async function appendMessage(imap, folder, raw, flags = []) {
  try {
    await imap.append(folder, raw, flags);
    logger.debug({ folder, flags }, 'Appended message');
  } catch (err) {
    logger.error({ folder, error: err.message }, 'Failed to append message');
    throw err;
  }
}

/**
 * Update labels (flags) on messages
 * @param {Object} imap - ImapFlow client
 * @param {Array} messages - Array of message objects with UIDs
 * @param {Array} labelsToSet - Array of labels to set
 * @param {Array} labelsToUnset - Array of labels to unset
 * @returns {Promise<void>} - Resolves when all labels are updated
 */
export async function updateLabels(
  imap,
  messages,
  labelsToSet = [],
  labelsToUnset = []
) {
  if (
    messages.length === 0 ||
    (labelsToSet.length === 0 && labelsToUnset.length === 0)
  ) {
    return;
  }

  const options = { uid: true };

  try {
    // Extract UIDs from messages
    const uids = messages.map(message => message.uid);

    // Add labels if there are any to set
    if (labelsToSet.length > 0) {
      logger.debug({ uids, flags: labelsToSet }, 'Adding flags to messages');
      await imap.messageFlagsAdd({ uid: uids }, labelsToSet, options);
      logger.debug({ uids, flags: labelsToSet }, 'Flags added successfully');
    }

    // Remove labels if there are any to unset
    if (labelsToUnset.length > 0) {
      logger.debug(
        { uids, flags: labelsToUnset },
        'Removing flags from messages'
      );
      await imap.messageFlagsRemove({ uid: uids }, labelsToUnset, options);
      logger.debug(
        { uids, flags: labelsToUnset },
        'Flags removed successfully'
      );
    }

    logger.debug(
      { updatedCount: messages.length },
      'All message flags updated'
    );
  } catch (err) {
    logger.error({ error: err.message }, 'Failed to update message flags');
    throw err;
  }
}

/**
 * Waits for new mail to arrive in `folder` via IMAP IDLE.
 * Registers exists/error/close listeners before acquiring the lock (to avoid
 * any race between lock acquisition and listener attachment), then opens a
 * read-only mailbox lock on `folder`.
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
 * @param {string} folder - Mailbox to watch (e.g. ctx.config.FOLDER_INBOX)
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal] - Aborting resolves the wait immediately (treated as a wakeup, not an error)
 * @param {number} [options.lastUid] - Last UID processed by the scanner; used for the pre-IDLE catch-up check
 * @param {number} [options.watchdogMs] - Max time to stay in IDLE before recycling regardless of activity; 0 disables it
 * @returns {Promise<void>}
 */
export async function waitForNewMail(
  imap,
  folder,
  { signal, lastUid, watchdogMs = config.IDLE_WATCHDOG_MS } = {}
) {
  let onExists, onError, onClose, onAbort;

  // Register listeners before acquiring the lock so no notification is missed
  // between the lock being granted and the listener being attached.
  const existsPromise = new Promise((resolve, reject) => {
    onExists = data => {
      logger.debug({ folder, data }, 'EXISTS notification received');
      resolve();
    };
    onError = err => {
      logger.debug(
        { folder, error: err.message },
        'Connection error while waiting for EXISTS'
      );
      reject(err);
    };
    onClose = () => {
      logger.debug({ folder }, 'Connection closed while waiting for EXISTS');
      reject(new Error('IMAP connection closed while waiting for EXISTS'));
    };
    onAbort = () => {
      logger.debug({ folder }, 'IDLE aborted by caller');
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
      logger.debug({ folder }, 'IDLE skipped - already aborted');
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
        { folder, lastUid, uidNext: imap.mailbox.uidNext },
        'New mail already present before IDLE - skipping wait'
      );
      return;
    }

    logger.debug(
      { folder, exists: imap.mailbox.exists },
      'Watching for new messages'
    );
    // Immediately enter IDLE without waiting for the 15-second autoidle delay.
    // Errors here are expected when IDLE is interrupted (e.g. lock released).
    imap
      .idle()
      .catch(err => logger.debug({ folder, error: err.message }, 'IDLE ended'));

    const racers = [existsPromise];
    if (watchdogMs > 0) {
      racers.push(
        delay(watchdogMs, undefined, { signal: watchdogController.signal })
          .then(() =>
            logger.debug(
              { folder, watchdogMs },
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
    logger.debug({ folder }, 'IDLE resolved');
  } finally {
    watchdogController.abort();
    cleanupListeners();
    lock.release();
  }
}
