import { ImapFlow } from 'imapflow';
import type { MailboxObject, SearchObject } from 'imapflow';
import type { Logger as PinoLogger } from 'pino';
import { collectFoldersToCreate } from 'shared/utils';
import { processMessage, processMessageHeaders } from './message.mapper.js';

/**
 * Open folder and return the box object
 */
export async function open(
  imap: ImapFlow,
  folder: string,
  readOnly = false,
  logger?: PinoLogger,
): Promise<MailboxObject> {
  try {
    // Check if the client is already connected
    if (!imap.usable) {
      await imap.connect();
    }

    logger?.debug({ folder }, 'Opening folder');
    const mailbox = await imap.mailboxOpen(folder, { readOnly });

    logger?.debug({ folder, messageCount: mailbox.exists }, 'Opened folder');
    return mailbox;
  } catch (err) {
    logger?.error(
      { folder, error: err instanceof Error ? err.message : String(err) },
      'Failed to open folder',
    );
    throw err;
  }
}

/**
 * Get message count from an opened folder box
 */
export function count(box: MailboxObject): number {
  return box.exists;
}

/**
 * Search for messages in an opened folder based on query
 * @param imap - ImapFlow client
 * @param query - Search query (array for node-imap compatibility, object for ImapFlow)
 * @returns - Array of message UIDs
 */
export async function search(
  imap: ImapFlow,
  query: SearchObject,
  logger?: PinoLogger,
): Promise<number[]> {
  try {
    logger?.debug({ query }, 'Searching messages');
    const results = await imap.search(query, { uid: true });

    if (!results || !results.length) {
      logger?.debug({ query }, 'No messages found');
      return [];
    } else {
      logger?.debug({ query, total: results.length }, 'Found messages');
      return results;
    }
  } catch (err) {
    logger?.error(
      { query, error: err instanceof Error ? err.message : String(err) },
      'Error searching messages',
    );
    throw err;
  }
}

/**
 * Fetch messages by UID
 * @param imap - ImapFlow client
 * @param uids - Array of UIDs to fetch
 * @returns - Array of message objects with uid, flags, envelope, and a raw Buffer
 */
export async function fetchMessagesByUIDs(
  imap: ImapFlow,
  uids: number[],
  logger?: PinoLogger,
): Promise<ReturnType<typeof processMessage>[]> {
  try {
    const messages: ReturnType<typeof processMessage>[] = [];
    const _messages = imap.fetch(
      { uid: uids.join(',') },
      {
        uid: true,
        source: true,
        envelope: true,
        bodyStructure: true,
        flags: true,
      },
      { uid: true },
    );

    for await (const message of _messages) {
      messages.push(processMessage(message));
    }

    logger?.debug(
      { uids, messageCount: messages.length },
      'Fetched messages by UIDs',
    );
    return messages;
  } catch (err) {
    logger?.error(
      { error: err instanceof Error ? err.message : String(err), uids },
      'Error fetching messages by UIDs',
    );
    throw err;
  }
}

/**
 * Fetch only message headers by UID - see `processMessageHeaders` for why
 * this exists as a separate, cheaper primitive from `fetchMessagesByUIDs`.
 * @param imap - ImapFlow client
 * @param uids - Array of UIDs to fetch
 * @returns - Array of `{uid, headers}` objects
 */
export async function fetchMessageHeadersByUIDs(
  imap: ImapFlow,
  uids: number[],
  logger?: PinoLogger,
): Promise<ReturnType<typeof processMessageHeaders>[]> {
  try {
    const messages: ReturnType<typeof processMessageHeaders>[] = [];
    const _messages = imap.fetch(
      { uid: uids.join(',') },
      { uid: true, headers: true },
      { uid: true },
    );

    for await (const message of _messages) {
      messages.push(processMessageHeaders(message));
    }

    logger?.debug(
      { uids, messageCount: messages.length },
      'Fetched message headers by UIDs',
    );
    return messages;
  } catch (err) {
    logger?.error(
      { error: err instanceof Error ? err.message : String(err), uids },
      'Error fetching message headers by UIDs',
    );
    throw err;
  }
}

/**
 * Move all messages to destination folder
 * @param imap - ImapFlow client
 * @param messages - Array of message objects with UIDs
 * @param destFolder - Destination folder
 */
export async function moveMessages(
  imap: ImapFlow,
  messages: Array<{ uid: number }>,
  destFolder: string,
  logger?: PinoLogger,
): Promise<void> {
  if (messages.length === 0) {
    return;
  }

  try {
    // Extract UIDs from messages
    const uids = messages.map((message) => message.uid);
    logger?.debug({ uids, destFolder }, 'Moving messages');

    // Move all messages at once
    await imap.messageMove(uids, destFolder, { uid: true });

    logger?.debug({ total: messages.length, destFolder }, 'All messages moved');
  } catch (err) {
    logger?.error(
      { destFolder, error: err instanceof Error ? err.message : String(err) },
      'Failed to move messages',
    );
    throw err;
  }
}

/**
 * Append a raw RFC822 message to a folder.
 * @param imap - ImapFlow client
 * @param folder - Destination folder
 * @param raw - Raw RFC822 message source
 * @param flags - IMAP flags to set on append (e.g. ['\\Seen']); omit to leave the message unread
 */
export async function appendMessage(
  imap: ImapFlow,
  folder: string,
  raw: string | Buffer,
  flags: string[] = [],
  logger?: PinoLogger,
): Promise<void> {
  try {
    await imap.append(folder, raw, flags);
    logger?.debug({ folder, flags }, 'Appended message');
  } catch (err) {
    logger?.error(
      { folder, error: err instanceof Error ? err.message : String(err) },
      'Failed to append message',
    );
    throw err;
  }
}

/**
 * Update labels (flags) on messages
 * @param imap - ImapFlow client
 * @param messages - Array of message objects with UIDs
 * @param labelsToSet - Array of labels to set
 * @param labelsToUnset - Array of labels to unset
 * @returns - Resolves when all labels are updated
 */
export async function updateLabels(
  imap: ImapFlow,
  messages: Array<{ uid: number }>,
  labelsToSet: string[] = [],
  labelsToUnset: string[] = [],
  logger?: PinoLogger,
): Promise<void> {
  if (
    messages.length === 0 ||
    (labelsToSet.length === 0 && labelsToUnset.length === 0)
  ) {
    return;
  }

  const options = { uid: true };

  try {
    // Extract UIDs from messages
    const uids = messages.map((message) => message.uid);

    // Add labels if there are any to set
    if (labelsToSet.length > 0) {
      logger?.debug({ uids, flags: labelsToSet }, 'Adding flags to messages');
      await imap.messageFlagsAdd(uids, labelsToSet, options);
      logger?.debug({ uids, flags: labelsToSet }, 'Flags added successfully');
    }

    // Remove labels if there are any to unset
    if (labelsToUnset.length > 0) {
      logger?.debug(
        { uids, flags: labelsToUnset },
        'Removing flags from messages',
      );
      await imap.messageFlagsRemove(uids, labelsToUnset, options);
      logger?.debug(
        { uids, flags: labelsToUnset },
        'Flags removed successfully',
      );
    }

    logger?.debug(
      { updatedCount: messages.length },
      'All message flags updated',
    );
  } catch (err) {
    logger?.error(
      { error: err instanceof Error ? err.message : String(err) },
      'Failed to update message flags',
    );
    throw err;
  }
}

/**
 * Retrieves the IMAP folder hierarchy delimiter.
 * @param imap - An active and connected ImapFlow client instance.
 * @returns The folder delimiter (e.g., "/", "."), or null if not found.
 */
export async function getImapDelimiter(imap: ImapFlow): Promise<string | null> {
  const mailboxes = await imap.list();
  for (const mailbox of mailboxes) {
    if (mailbox.delimiter) {
      return mailbox.delimiter;
    }
  }
  return null;
}

export async function createAppFolders(
  imap: ImapFlow,
  folders: string[],
  logger?: PinoLogger,
): Promise<void> {
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
    logger?.debug({ folder: folderPath }, `Ensuring existence of folder`);
    const res = await imap.mailboxCreate(folderPath);
    if (res.created === false) {
      logger?.debug({ folder: folderPath }, 'Folder exists');
    } else {
      logger?.info({ folder: folderPath }, 'Created folder');
    }
  }
}
