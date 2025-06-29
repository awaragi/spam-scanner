import {createAppFolders} from './lib/imap-client.js';
import pino from 'pino';
import {config} from "./lib/util.js";

const logger = pino();

logger.info('Starting folder initialization');
await createAppFolders([config.FOLDER_TRAIN_SPAM, config.FOLDER_TRAIN_HAM, config.FOLDER_TRAIN_WHITELIST, config.FOLDER_STATE]);
logger.info('Folder initialization completed');
