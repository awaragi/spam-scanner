import { moveMessages } from '../../clients/imap.client.js';
import { rootLogger } from '../../core/logger.js';
import { createDefaultContext } from '../../core/context.js';

const logger = rootLogger.forComponent('folder-move');

/**
 * Moves messages to spam-likelihood folders based on their spam tier.
 * @param {Object} imap - ImapFlow client
 * @param {{nonSpamMessages: Array, lowSpamMessages: Array, highSpamMessages: Array}} categorized
 * @param {Object} [ctx]
 * @returns {Promise<void>}
 */
export async function moveToFolders(
  imap,
  { nonSpamMessages, lowSpamMessages, highSpamMessages },
  ctx = createDefaultContext()
) {
  const { FOLDER_INBOX, FOLDER_SPAM_LOW, FOLDER_SPAM_HIGH } = ctx.config;
  logger.debug({ mode: 'folder' }, 'Processing messages with folder strategy');

  if (!FOLDER_SPAM_LOW) {
    throw new Error(
      'FOLDER_SPAM_LOW configuration is required for folder processing mode'
    );
  }

  if (!FOLDER_SPAM_HIGH) {
    throw new Error(
      'FOLDER_SPAM_HIGH configuration is required for folder processing mode'
    );
  }

  logger.debug(
    { count: nonSpamMessages.length, folder: FOLDER_INBOX },
    'Not touching non-spam messages'
  );

  logger.debug(
    { count: lowSpamMessages.length, folder: FOLDER_SPAM_LOW },
    'Moving low spam messages'
  );
  await moveMessages(imap, lowSpamMessages, FOLDER_SPAM_LOW);

  logger.debug(
    { count: highSpamMessages.length, folder: FOLDER_SPAM_HIGH },
    'Moving high spam messages'
  );
  await moveMessages(imap, highSpamMessages, FOLDER_SPAM_HIGH);

  logger.debug('Folder processing completed');
}
