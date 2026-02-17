import {BaseProcessor} from './base-processor.js';
import {updateLabels} from '../clients/imap-client.js';
import {config} from '../utils/config.js';
import {rootLogger} from '../utils/logger.js';

const logger = rootLogger.forComponent('label-processor');

const LABEL_SPAM_LOW = config.LABEL_SPAM_LOW;
const LABEL_SPAM_HIGH = config.LABEL_SPAM_HIGH;

/**
 * Label processor - applies Gmail-style labels to messages
 * This is the current default processing mode
 */
export class LabelProcessor extends BaseProcessor {
  /**
   * Process messages by applying appropriate spam labels
   * @param {Object} imap - ImapFlow client
   * @param {Object} categorized - Categorized messages
   * @param {Array} categorized.nonSpamMessages - Clean messages
   * @param {Array} categorized.lowSpamMessages - Low spam messages
   * @param {Array} categorized.highSpamMessages - High spam messages
   * @returns {Promise<void>}
   */
  async process(imap, {nonSpamMessages, lowSpamMessages, highSpamMessages}) {
    logger.info({mode: 'label'}, 'Processing messages with label strategy');

    // Reset spam labels on non-spam messages
    logger.info({count: nonSpamMessages.length}, 'Resetting spam labels on clean messages');
    await updateLabels(imap, nonSpamMessages, [], [LABEL_SPAM_LOW, LABEL_SPAM_HIGH]);

    // Apply Spam:Low label
    logger.info({count: lowSpamMessages.length}, 'Applying Spam:Low label');
    await updateLabels(imap, lowSpamMessages, [LABEL_SPAM_LOW], [LABEL_SPAM_HIGH]);

    // Apply Spam:High label
    logger.info({count: highSpamMessages.length}, 'Applying Spam:High label');
    await updateLabels(imap, highSpamMessages, [LABEL_SPAM_HIGH], [LABEL_SPAM_LOW]);

    logger.debug('Label processing completed');
  }
}
