import { createAppFolders } from '../../clients/imap.client.js';
import { rootLogger } from '../../core/logger.js';
import { resolveFolders } from '../../clients/folder-resolver.client.js';
import { createDefaultContext } from '../../core/context.js';

const logger = rootLogger.forComponent('init-controller');

/**
 * Run folder initialization workflow.
 * Resolves configured folder paths against the server's real delimiter, then
 * creates all required IMAP folders if they don't exist.
 * @param {Object} imap - ImapFlow client
 * @param {Object} [ctx]
 * @returns {Promise<void>}
 */
export async function runInit(imap, ctx = createDefaultContext()) {
  await resolveFolders(imap);

  const { config } = ctx;
  const folders = [
    config.FOLDER_TRAIN_SPAM,
    config.FOLDER_TRAIN_HAM,
    config.FOLDER_TRAIN_WHITELIST,
    config.FOLDER_TRAIN_BLACKLIST,
    config.FOLDER_STATE,
    config.FOLDER_SPAM,
  ];

  if (config.SPAM_PROCESSING_MODE === 'folder') {
    logger.debug(
      'Processing mode is folder, including spam likelihood folders'
    );
    folders.push(config.FOLDER_SPAM_LOW, config.FOLDER_SPAM_HIGH);
  }

  await createAppFolders(imap, folders);
  logger.debug('Folder initialization completed');
}
