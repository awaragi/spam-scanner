import {rootLogger} from './logger.js';
import {homedir, userInfo} from "os";

const logger = rootLogger.forComponent('config');

export const config = (() => {
  const c = {
    HOME: homedir(),
    USER: userInfo().username,

    IMAP_HOST: process.env.IMAP_HOST,
    IMAP_PORT: parseInt(process.env.IMAP_PORT || '993', 10),
    IMAP_USER: process.env.IMAP_USER,
    IMAP_PASSWORD: process.env.IMAP_PASSWORD,
    IMAP_TLS: process.env.IMAP_TLS === 'true',

    FOLDER_INBOX: process.env.FOLDER_INBOX || 'INBOX',
    FOLDER_SPAM: process.env.FOLDER_SPAM || 'INBOX.spam',
    FOLDER_TRAIN_SPAM: process.env.FOLDER_TRAIN_SPAM || 'INBOX.scanner.train.spam',
    FOLDER_TRAIN_HAM: process.env.FOLDER_TRAIN_HAM || 'INBOX.scanner.train.ham',
    FOLDER_TRAIN_WHITELIST: process.env.FOLDER_TRAIN_WHITELIST || 'INBOX.scanner.train.whitelist',
    FOLDER_TRAIN_BLACKLIST: process.env.FOLDER_TRAIN_BLACKLIST || 'INBOX.scanner.train.blacklist',
    FOLDER_STATE: process.env.FOLDER_STATE || 'scanner.state',
    STATE_KEY_SCANNER: process.env.STATE_KEY_SCANNER || 'scanner',
    STATE_KEY_WHITELIST_MAP: process.env.STATE_KEY_WHITELIST_MAP || 'rspamd-whitelist-map',
    STATE_KEY_BLACKLIST_MAP: process.env.STATE_KEY_BLACKLIST_MAP || 'rspamd-blacklist-map',

    SCAN_BATCH_SIZE: parseInt(process.env.SCAN_BATCH_SIZE || '200', 10),
    SCAN_READ: process.env.SCAN_READ === 'true',
    PROCESS_BATCH_SIZE: parseInt(process.env.PROCESS_BATCH_SIZE || '10'),

    SPAM_LABEL_LOW: process.env.SPAM_LABEL_LOW || 'Spam:Low',
    SPAM_LABEL_HIGH: process.env.SPAM_LABEL_HIGH || 'Spam:High',

    RSPAMD_URL: process.env.RSPAMD_URL || 'http://localhost:11334',
    RSPAMD_PASSWORD: process.env.RSPAMD_PASSWORD || '',
    RSPAMD_WHITELIST_MAP_PATH: process.env.RSPAMD_WHITELIST_MAP_PATH || 'rspamd/maps/whitelist.map',
    RSPAMD_BLACKLIST_MAP_PATH: process.env.RSPAMD_BLACKLIST_MAP_PATH || 'rspamd/maps/blacklist.map'
  };

  logger.debug(c,'Loading configuration');
  return c;
})();
