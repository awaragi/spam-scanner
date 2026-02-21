import {createAppFolders} from '../clients/imap-client.js';
import {rootLogger} from '../utils/logger.js';
import {config} from '../utils/config.js';

const logger = rootLogger.forComponent('init-workflow');

/**
 * Run folder initialization workflow
 * Creates all required IMAP folders if they don't exist
 * @param {Object} imap - ImapFlow client
 * @returns {Promise<void>}
 */
export async function runInit(imap) {
  const folders = [
    config.FOLDER_TRAIN_SPAM,
    config.FOLDER_TRAIN_HAM,
    config.FOLDER_TRAIN_WHITELIST,
    config.FOLDER_TRAIN_BLACKLIST,
    config.FOLDER_STATE
  ];

  if (config.SPAM_PROCESSING_MODE === 'folder') {
    logger.debug('Processing mode is folder, including spam likelihood folders');
    folders.push(config.FOLDER_SPAM_LOW, config.FOLDER_SPAM_HIGH);
  }

  await createAppFolders(imap, folders);
  logger.debug('Folder initialization completed');
}
