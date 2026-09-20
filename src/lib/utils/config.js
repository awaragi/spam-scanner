import { rootLogger } from './logger.js';
import { homedir, userInfo } from 'os';

const logger = rootLogger.forComponent('config');

export const config = (() => {
  const c = {
    HOME: homedir(),
    USER: userInfo().username,

    IMAP_HOST: process.env.IMAP_HOST,
    IMAP_PORT: parseInt(process.env.IMAP_PORT || '993', 10),
    IMAP_USER: process.env.IMAP_USER,
    IMAP_PASSWORD: process.env.IMAP_PASSWORD,
    IMAP_TLS: process.env.IMAP_TLS !== 'false',

    FOLDER_INBOX: process.env.FOLDER_INBOX || 'INBOX',
    FOLDER_SPAM: process.env.FOLDER_SPAM || 'INBOX.spam',
    FOLDER_SPAM_LOW: process.env.FOLDER_SPAM_LOW || 'INBOX.spam.low',
    FOLDER_SPAM_HIGH: process.env.FOLDER_SPAM_HIGH || 'INBOX.spam.high',
    FOLDER_TRAIN_SPAM:
      process.env.FOLDER_TRAIN_SPAM || 'INBOX.scanner.train.spam',
    FOLDER_TRAIN_HAM: process.env.FOLDER_TRAIN_HAM || 'INBOX.scanner.train.ham',
    FOLDER_TRAIN_WHITELIST:
      process.env.FOLDER_TRAIN_WHITELIST || 'INBOX.scanner.train.whitelist',
    FOLDER_TRAIN_BLACKLIST:
      process.env.FOLDER_TRAIN_BLACKLIST || 'INBOX.scanner.train.blacklist',
    FOLDER_STATE: process.env.FOLDER_STATE || 'scanner.state',
    STATE_KEY_SCANNER: process.env.STATE_KEY_SCANNER || 'scanner',
    STATE_KEY_WHITELIST_MAP:
      process.env.STATE_KEY_WHITELIST_MAP || 'rspamd-whitelist-map',
    STATE_KEY_BLACKLIST_MAP:
      process.env.STATE_KEY_BLACKLIST_MAP || 'rspamd-blacklist-map',

    SCAN_BATCH_SIZE: parseInt(process.env.SCAN_BATCH_SIZE || '200', 10),
    MAX_RETRIES: parseInt(process.env.MAX_RETRIES || '5', 10),
    SCAN_READ: process.env.SCAN_READ === 'true',
    PROCESS_BATCH_SIZE: parseInt(process.env.PROCESS_BATCH_SIZE || '10'),
    SCAN_INITIAL_STATE: (process.env.SCAN_INITIAL_STATE || 'new').toLowerCase(),
    IDLE_WATCHDOG_MS: parseInt(process.env.IDLE_WATCHDOG_MS || '1200000', 10),

    LABEL_SPAM_LOW: process.env.LABEL_SPAM_LOW || 'Spam:Low',
    LABEL_SPAM_HIGH: process.env.LABEL_SPAM_HIGH || 'Spam:High',
    SPAM_PROCESSING_MODE: process.env.SPAM_PROCESSING_MODE || 'folder',

    RSPAMD_URL: process.env.RSPAMD_URL || 'http://localhost:11334',
    RSPAMD_PASSWORD: process.env.RSPAMD_PASSWORD || '',
    RSPAMD_TIMEOUT_MS: parseInt(process.env.RSPAMD_TIMEOUT_MS || '30000', 10),

    SPAM_CLEAN_THRESHOLD: parseInt(
      process.env.SPAM_CLEAN_THRESHOLD || '30',
      10
    ),
    SPAM_LOW_THRESHOLD: parseInt(process.env.SPAM_LOW_THRESHOLD || '60', 10),
    SPAM_CONFIRMED_THRESHOLD: parseInt(
      process.env.SPAM_CONFIRMED_THRESHOLD || '200',
      10
    ),

    AI_ENABLED: process.env.AI_ENABLED === 'true',
    AI_BASE_URL: process.env.AI_BASE_URL || 'https://api.openai.com/v1',
    AI_API_KEY: process.env.AI_API_KEY || '',
    AI_MODEL: process.env.AI_MODEL || '',
    AI_TIMEOUT_MS: parseInt(process.env.AI_TIMEOUT_MS || '15000', 10),
    AI_MAX_RETRIES: parseInt(process.env.AI_MAX_RETRIES || '1', 10),
    AI_CONCURRENCY: parseInt(process.env.AI_CONCURRENCY || '5', 10),
    AI_MAX_INPUT_TOKENS: parseInt(
      process.env.AI_MAX_INPUT_TOKENS || '6000',
      10
    ),
    AI_MAX_OUTPUT_TOKENS: parseInt(
      process.env.AI_MAX_OUTPUT_TOKENS || '2000',
      10
    ),
    AI_ESCALATE_TO_LOW_THRESHOLD: parseInt(
      process.env.AI_ESCALATE_TO_LOW_THRESHOLD || '50',
      10
    ),
    AI_ESCALATE_TO_HIGH_THRESHOLD: parseInt(
      process.env.AI_ESCALATE_TO_HIGH_THRESHOLD || '80',
      10
    ),
    AI_USER_PROFILE: process.env.AI_USER_PROFILE || '',
    AI_FAILURE_ALERT_THRESHOLD: parseInt(
      process.env.AI_FAILURE_ALERT_THRESHOLD || '3',
      10
    ),
  };

  // AI_MODEL has no default - fail fast at load time rather than let every
  // AI classification call fail individually once AI is enabled.
  if (c.AI_ENABLED && !c.AI_MODEL) {
    throw new Error(
      'AI_MODEL is required when AI_ENABLED=true (no default - set it explicitly, e.g. "gpt-4o-mini" or your provider\'s model name)'
    );
  }

  if (!['new', 'all'].includes(c.SCAN_INITIAL_STATE)) {
    throw new Error(
      `SCAN_INITIAL_STATE must be "new" or "all" (got "${c.SCAN_INITIAL_STATE}")`
    );
  }

  logger.debug(c, 'Loading configuration');
  return c;
})();
