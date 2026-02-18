import {createAppFolders, newClient} from './lib/clients/imap-client.js';
import {rootLogger} from './lib/utils/logger.js';
import {config} from "./lib/utils/config.js";

const logger = rootLogger.forComponent('init-folders');
const imap = newClient();

logger.info('Starting folder initialization');

try {
  await imap.connect();
  
  // Base folders that are always created
  const folders = [
    config.FOLDER_TRAIN_SPAM,
    config.FOLDER_TRAIN_HAM,
    config.FOLDER_TRAIN_WHITELIST,
    config.FOLDER_TRAIN_BLACKLIST,
    config.FOLDER_STATE
  ];
  
  // Add spam likelihood folders if processing mode is 'folder'
  if (config.SPAM_PROCESSING_MODE === 'folder') {
    logger.info('Processing mode is folder, including spam likelihood folders');
    folders.push(config.FOLDER_SPAM_LOW, config.FOLDER_SPAM_HIGH);
  }
  
  await createAppFolders(imap, folders);
  logger.info('Folder initialization completed');
} finally {
  await imap.logout();
}
