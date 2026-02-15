import {createAppFolders, newClient} from './lib/imap-client.js';
import {rootLogger} from './lib/utils/logger.js';
import {config} from "./lib/utils/config.js";

const logger = rootLogger.forComponent('init-folders');
const imap = newClient();

logger.info('Starting folder initialization');

try {
  await imap.connect();
  await createAppFolders(imap, [config.FOLDER_TRAIN_SPAM, config.FOLDER_TRAIN_HAM, config.FOLDER_TRAIN_WHITELIST, config.FOLDER_TRAIN_BLACKLIST, config.FOLDER_STATE]);
  logger.info('Folder initialization completed');
} finally {
  await imap.logout();
}
