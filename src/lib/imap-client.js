import {ImapFlow} from 'imapflow';
import {config} from './utils/config.js';
import pino from 'pino';
import {parseEmail, stripSpamHeaders} from './utils/email-parser.js';
import {collectFoldersToCreate} from "./utils/mailboxes-utils.js";

const logger = pino();

export function newClient() {
  return new ImapFlow({
    host: config.IMAP_HOST,
    port: config.IMAP_PORT,
    secure: config.IMAP_TLS === true,
    auth: {
      user: config.IMAP_USER,
      pass: config.IMAP_PASSWORD
    },
    logger: logger.child({ component: 'imapflow' }),
    emitLogs: false
  });
}

/**
 * Retrieves the IMAP folder hierarchy delimiter.
 * @param {ImapFlow} imap - An active and connected ImapFlow client instance.
 * @returns {Promise<string|null>} The folder delimiter (e.g., "/", "."), or null if not found.
 */
async function getImapDelimiter(imap) {
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
  if(!separator) {
     throw new Error('Failed to get folder separator');
  }
  // First collect and order all folder paths that need to be created
  const foldersToCreate = collectFoldersToCreate(folders, separator);

  // Now attempt to create the folders in order
  for (const folderPath of foldersToCreate) {
    logger.info({folder: folderPath}, `Creating folder ${folderPath}`);
      const res = await imap.mailboxCreate(folderPath);
      if (res.created === false) {
        logger.info({folder: folderPath}, 'Folder exists');
      } else {
        logger.info({folder: folderPath}, 'Created folder');
      }
    }
}
export async function findFirstUIDOnDate(imap, folder, dateString) {
  try {
    // Open the mailbox in read-only mode
    await imap.mailboxOpen(folder, { readOnly: true });

    // Prepare search criteria
    const criteria = dateString ? { since: new Date(dateString) } : {};
    logger.debug({folder, criteria}, 'Searching messages');

    // Search for messages
    const results = await imap.search(criteria);

    if (!results.length) {
      logger.debug({folder}, 'No messages found');
      return null;
    }

    // Get the first message
    const message = await imap.fetchOne(results[0], { envelope: true });

    if (!message) {
      logger.debug({folder}, 'Failed to fetch message');
      return null;
    }

    const last_uid = message.uid;
    const last_seen_date = message.envelope.date.toISOString();
    const last_checked = new Date().toISOString();

    return {
      last_uid,
      last_seen_date,
      last_checked
    };
  } catch (err) {
    logger.error({folder, error: err.message}, 'Error in findFirstUIDOnDate');
    throw err;
  }
}


/**
 * Helper function to handle message fetching common code
 * @param {Object} message - The message object from ImapFlow
 * @returns {Object} - Object containing raw message, uid, and attributes
 */
export function processMessage(message) {
  const {uid, flags, envelope} = message;
  // ImapFlow returns a Buffer for message.source
  const raw = stripSpamHeaders(message.source.toString());
  const {body, headers} = parseEmail(raw);

  logger.debug({uid}, 'Message read');

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
 * Open folder and return the box object
 */
export async function open(imap, folder, readOnly = false) {
  try {
    // Check if the client is already connected
    if (!imap.usable) {
      await imap.connect();
    }

    logger.debug({folder}, 'Opening folder');
    const mailbox = await imap.mailboxOpen(folder, { readOnly });

    logger.info({folder, messageCount: mailbox.exists}, 'Opened folder');
    return mailbox;
  } catch (err) {
    logger.error({folder, error: err.message}, 'Failed to open folder');
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
    logger.info({ query: query }, 'Searching messages');
    const results = await imap.search(query, { uid: true });

    if (!results.length) {
      logger.info({query},'No messages found');
      return [];
    } else {
      logger.info({query, total: results.length}, 'Found messages');
      return results;
    }
  } catch (err) {
    logger.error({ query, error: err.message }, 'Error searching messages');
    throw err;
  }
}

/**
 * for learnFromFolder: Fetch all messages sequentially
 * @param {Object} imap - ImapFlow client
 * @returns {Promise<Array>} - Array of message objects with uid, raw content, and attributes
 */
export async function fetchAllMessages(imap) {
  try {
    const messages = [];

    // Use for await to process messages one by one
    for await (const message of imap.fetch('1:*', { source: true, envelope: true, bodyStructure: true, flags: true })) {
      messages.push(processMessage(message));
    }

    logger.info({messageCount: messages.length}, 'Fetched all messages');
    return messages;
  } catch (err) {
    logger.error({ error: err.message }, 'Error fetching all messages');
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
    const _messages = imap.fetch({uid: uids.join(',')}, {
      uid: true,
      source: true,
      envelope: true,
      bodyStructure: true,
      flags: true
    }, {uid: true});

    for await (const message of _messages) {
      messages.push(processMessage(message));
    }

    logger.info({uids, messageCount: messages.length}, 'Fetched messages by UIDs');
    return messages;
  } catch (err) {
    logger.error({ error: err.message, uids }, 'Error fetching messages by UIDs');
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
  try {
    logger.debug({uid, destFolder: dest}, 'Moving message by UID');

    // Move the message
    await imap.messageMove({ uid }, dest);
    logger.info({uid, destFolder: dest}, 'Successfully moved message by UID');

    // Expunge to ensure the move is committed
    logger.debug('Expunging to finalize the move operation');
    await imap.mailboxExpunge();

    logger.info({uid, destFolder: dest}, 'Move completed with expunge');
  } catch (err) {
    logger.error({uid, destFolder: dest, error: err.message}, 'Failed to move message by UID');
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
    logger.debug({uids, destFolder}, 'Moving messages');

    // Move all messages at once
    await imap.messageMove(uids, destFolder, {uid: true});

    logger.info({total: messages.length, destFolder}, 'All messages moved');
  } catch (err) {
    logger.error({destFolder, error: err.message}, 'Failed to move messages');
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
export async function updateLabels(imap, messages, labelsToSet = [], labelsToUnset = []) {
  if (messages.length === 0 || (labelsToSet.length === 0 && labelsToUnset.length === 0)) {
    return;
  }

  const options = {uid: true};

  try {
    // Extract UIDs from messages
    const uids = messages.map(message => message.uid);

    // Add labels if there are any to set
    if (labelsToSet.length > 0) {
      logger.debug({uids, flags: labelsToSet}, 'Adding flags to messages');
      await imap.messageFlagsAdd({ uid: uids }, labelsToSet, options);
      logger.info({uids, flags: labelsToSet}, 'Flags added successfully');
    }

    // Remove labels if there are any to unset
    if (labelsToUnset.length > 0) {
      logger.debug({uids, flags: labelsToUnset}, 'Removing flags from messages');
      await imap.messageFlagsRemove({ uid: uids }, labelsToUnset, options);
      logger.info({uids, flags: labelsToUnset}, 'Flags removed successfully');
    }

    logger.info({updatedCount: messages.length}, 'All message flags updated');
  } catch (err) {
    logger.error({error: err.message}, 'Failed to update message flags');
    throw err;
  }
}