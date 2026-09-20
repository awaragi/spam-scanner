import { rootLogger } from '../utils/logger.js';
import { config } from '../utils/config.js';
import {
  open,
  count,
  fetchAllMessages,
  moveMessages,
} from '../clients/imap-client.js';
import {
  extractSenderAddresses,
  updateListState,
} from '../services/map-service.js';

const logger = rootLogger.forComponent('map-workflow');

/**
 * Generic map training workflow handler
 * @param {Object} imap - ImapFlow client
 * @param {string} folder - Training folder path
 * @param {string} mapStateKey - State key identifying the mailbox's IMAP-backed whitelist/blacklist (see config.js STATE_KEY_WHITELIST_MAP/STATE_KEY_BLACKLIST_MAP)
 * @param {string} destFolder - Destination folder after processing
 * @param {string} type - Map type ('whitelist' or 'blacklist')
 * @returns {Promise<void>}
 */
async function runMapTraining(imap, folder, mapStateKey, destFolder, type) {
  try {
    const box = await open(imap, folder);
    const messageCount = count(box);

    if (messageCount === 0) {
      logger.debug({ folder, type }, 'No messages in training folder');
      return;
    }

    const messages = await fetchAllMessages(imap);
    const senders = extractSenderAddresses(messages);

    if (senders.length === 0) {
      logger.info(
        { folder, type, total: messages.length },
        `No extractable senders found among ${type} training messages; moving them on unlearned`
      );
    } else {
      // Training always appends - it merges newly extracted senders with
      // whatever's already in the mailbox's IMAP-backed list, never replaces it.
      const result = await updateListState(
        imap,
        mapStateKey,
        senders,
        'append'
      );
      logger.info({ folder, type, ...result }, `${type} list updated`);
    }

    // Move processed messages to destination folder
    await moveMessages(imap, messages, destFolder);
    logger.debug(
      { folder, type, destFolder, total: messages.length },
      'Training messages moved'
    );
  } catch (error) {
    logger.error(
      { folder, type, error: error.message },
      `Error in ${type} workflow`
    );
    throw error;
  }
}

/**
 * Run whitelist training workflow
 * Orchestrates extracting senders and updating the mailbox's IMAP-backed whitelist
 * @param {Object} imap - ImapFlow client
 * @returns {Promise<void>}
 */
export async function runWhitelist(imap) {
  await runMapTraining(
    imap,
    config.FOLDER_TRAIN_WHITELIST,
    config.STATE_KEY_WHITELIST_MAP,
    config.FOLDER_INBOX,
    'whitelist'
  );
}

/**
 * Run blacklist training workflow
 * Orchestrates extracting senders and updating the mailbox's IMAP-backed blacklist
 * @param {Object} imap - ImapFlow client
 * @returns {Promise<void>}
 */
export async function runBlacklist(imap) {
  await runMapTraining(
    imap,
    config.FOLDER_TRAIN_BLACKLIST,
    config.STATE_KEY_BLACKLIST_MAP,
    config.FOLDER_SPAM,
    'blacklist'
  );
}
