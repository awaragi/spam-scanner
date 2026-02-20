import {BaseProcessor} from './base-processor.js';
import {rootLogger} from '../utils/logger.js';

const logger = rootLogger.forComponent('color-processor');

/**
 * Color processor - applies color flags to messages (Apple Mail style)
 * Future implementation for color-based spam indication
 */
export class ColorProcessor extends BaseProcessor {
  /**
   * Process messages by applying color flags
   * @param {Object} imap - ImapFlow client
   * @param {Object} categorized - Categorized messages
   * @param {Array} categorized.nonSpamMessages - Clean messages (no color)
   * @param {Array} categorized.lowSpamMessages - Low spam messages (yellow)
   * @param {Array} categorized.highSpamMessages - High spam messages (orange/red)
   * @returns {Promise<void>}
   */
  async process(imap, {nonSpamMessages, lowSpamMessages, highSpamMessages}) {
    logger.debug({mode: 'color'}, 'Processing messages with color strategy');

    // Future implementation: Apply color flags to messages
    // This requires implementation of color flag support in imap-client
    // Possible colors: yellow (low spam), orange/red (high spam)
    
    logger.warn('Color processing not yet implemented - this is a stub');
    logger.debug({
      nonSpamCount: nonSpamMessages.length,
      lowSpamCount: lowSpamMessages.length,
      highSpamCount: highSpamMessages.length
    }, 'Messages ready for color processing (when implemented)');
  }
}
