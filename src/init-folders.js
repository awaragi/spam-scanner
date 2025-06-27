import {getConfig} from "./lib/util.js";
import {createAppFolders} from './lib/imap-client.js';
import pino from 'pino';

const config = getConfig();
const logger = pino();

logger.info('Starting folder initialization');
await createAppFolders([config.FOLDER_TRAIN_SPAM, config.FOLDER_TRAIN_HAM, config.FOLDER_STATE]);
logger.info('Folder initialization completed');