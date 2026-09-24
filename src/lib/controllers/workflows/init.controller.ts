import type { ImapFlow } from 'imapflow';
import { createAppFolders } from '../../clients/imap.client.ts';
import { rootLogger } from '../../core/logger.ts';
import { resolveFolders } from '../../clients/folder-resolver.client.ts';
import { createDefaultContext, type Context } from '../../core/context.ts';

const logger = rootLogger.forComponent('init-controller');

/**
 * Run folder initialization workflow.
 * Resolves configured folder paths against the server's real delimiter, then
 * creates all required IMAP folders if they don't exist.
 * @param {Object} imap - ImapFlow client
 * @param {Object} [ctx]
 * @returns {Promise<void>}
 */
export async function runInit(
  imap: ImapFlow,
  ctx: Context = createDefaultContext()
): Promise<void> {
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
