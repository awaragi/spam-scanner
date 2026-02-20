import {BaseProcessor} from './base-processor.js';
import {moveMessages} from '../clients/imap-client.js';
import {config} from '../utils/config.js';
import {rootLogger} from '../utils/logger.js';

const logger = rootLogger.forComponent('folder-processor');

/**
 * Folder processor - moves messages to spam likelihood folders
 * Future implementation for spam likelihood folders feature
 */
export class FolderProcessor extends BaseProcessor {
  /**
   * Process messages by moving them to appropriate spam folders
   * @param {Object} imap - ImapFlow client
   * @param {Object} categorized - Categorized messages
   * @param {Array} categorized.nonSpamMessages - Clean messages (stay in inbox)
   * @param {Array} categorized.lowSpamMessages - Low spam messages
   * @param {Array} categorized.highSpamMessages - High spam messages
   * @returns {Promise<void>}
   */
  async process(imap, {nonSpamMessages, lowSpamMessages, highSpamMessages}) {
    logger.debug({mode: 'folder'}, 'Processing messages with folder strategy');

    // Validate required configuration
    if (!config.FOLDER_SPAM_LOW) {
      throw new Error('FOLDER_SPAM_LOW configuration is required for folder processing mode');
    }
    
    if (!config.FOLDER_SPAM_HIGH) {
      throw new Error('FOLDER_SPAM_HIGH configuration is required for folder processing mode');
    }

    // Move messages to spam likelihood folders
    logger.debug({count: lowSpamMessages.length, folder: config.FOLDER_SPAM_LOW}, 'Moving low spam messages');
    await moveMessages(imap, lowSpamMessages, config.FOLDER_SPAM_LOW);

    logger.debug({count: highSpamMessages.length, folder: config.FOLDER_SPAM_HIGH}, 'Moving high spam messages');
    await moveMessages(imap, highSpamMessages, config.FOLDER_SPAM_HIGH);

    logger.debug('Folder processing completed');
  }
}
