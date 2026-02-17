import {rootLogger} from '../utils/logger.js';

const logger = rootLogger.forComponent('processor');

/**
 * Abstract base processor for message processing strategies
 * Defines the interface that all concrete processors must implement
 */
export class BaseProcessor {
  /**
   * Process categorized messages
   * @param {Object} imap - ImapFlow client
   * @param {Object} categorized - Categorized messages object
   * @param {Array} categorized.nonSpamMessages - Messages with no spam
   * @param {Array} categorized.lowSpamMessages - Messages with low spam score
   * @param {Array} categorized.highSpamMessages - Messages with high spam score
   * @returns {Promise<void>}
   * @throws {Error} - Must be implemented by subclasses
   */
  async process(imap, categorized) {
    throw new Error('BaseProcessor.process() must be implemented by subclass');
  }
}

/**
 * Factory function to create appropriate processor based on mode
 * @param {string} mode - Processing mode: 'label', 'folder', or 'color'
 * @returns {Promise<BaseProcessor>} - Concrete processor instance
 * @throws {Error} - If mode is unknown
 */
export async function createProcessor(mode = 'label') {
  logger.debug({mode}, 'Creating processor');

  switch (mode) {
    case 'label': {
      // Lazy import to avoid circular dependencies
      const {LabelProcessor} = await import('./label-processor.js');
      return new LabelProcessor();
    }
    
    case 'folder': {
      const {FolderProcessor} = await import('./folder-processor.js');
      return new FolderProcessor();
    }
    
    case 'color': {
      const {ColorProcessor} = await import('./color-processor.js');
      return new ColorProcessor();
    }
    
    default:
      throw new Error(`Unknown processing mode: ${mode}. Expected 'label', 'folder', or 'color'`);
  }
}
