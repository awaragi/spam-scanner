import { rootLogger } from './logger.js';
import { homedir, userInfo } from 'os';

const logger = rootLogger.forComponent('config');

const DEFAULT_AI_BASE_URL = 'https://api.openai.com/v1';

/**
 * Declarative schema for every environment-variable-sourced config field
 * (see the `config-validation` capability). Single source of truth for
 * type, default, and validation - `config.js` no longer parses each field
 * ad hoc at its point of use.
 *
 * Fields with `required: true` have no safe default and are NOT validated
 * here at module load (see `assertRequiredConfig` below) - only checked
 * when an entry point that actually needs them explicitly asks. Every
 * other field IS validated unconditionally at load, since it always
 * produces a valid value even with nothing set in the environment.
 *
 * `type: 'boolean'` parses `raw !== 'false'` when `default: true` (an
 * explicit "false" opts out), or `raw === 'true'` when `default: false`
 * (an explicit "true" opts in) - matching each field's existing semantics.
 * `type: 'enum'` validates `raw` is one of `allowedValues`;
 * `caseInsensitive: true` lowercases both the input and the stored value
 * before comparing (only `SCAN_INITIAL_STATE` does this today).
 */
const SCHEMA = [
  { key: 'IMAP_HOST', type: 'string', required: true },
  { key: 'IMAP_PORT', type: 'int', default: 993 },
  { key: 'IMAP_USER', type: 'string', required: true },
  { key: 'IMAP_PASSWORD', type: 'string', required: true, secret: true },
  { key: 'IMAP_TLS', type: 'boolean', default: true },

  { key: 'FOLDER_INBOX', type: 'string', default: 'INBOX' },
  { key: 'FOLDER_SPAM', type: 'string', default: 'INBOX.spam' },
  { key: 'FOLDER_SPAM_LOW', type: 'string', default: 'INBOX.spam.low' },
  { key: 'FOLDER_SPAM_HIGH', type: 'string', default: 'INBOX.spam.high' },
  {
    key: 'FOLDER_TRAIN_SPAM',
    type: 'string',
    default: 'INBOX.scanner.train.spam',
  },
  {
    key: 'FOLDER_TRAIN_HAM',
    type: 'string',
    default: 'INBOX.scanner.train.ham',
  },
  {
    key: 'FOLDER_TRAIN_WHITELIST',
    type: 'string',
    default: 'INBOX.scanner.train.whitelist',
  },
  {
    key: 'FOLDER_TRAIN_BLACKLIST',
    type: 'string',
    default: 'INBOX.scanner.train.blacklist',
  },
  { key: 'FOLDER_STATE', type: 'string', default: 'INBOX.scanner.state' },

  { key: 'STATE_KEY_SCANNER', type: 'string', default: 'scanner' },
  {
    key: 'STATE_KEY_WHITELIST_MAP',
    type: 'string',
    default: 'rspamd-whitelist-map',
  },
  {
    key: 'STATE_KEY_BLACKLIST_MAP',
    type: 'string',
    default: 'rspamd-blacklist-map',
  },

  { key: 'SCAN_BATCH_SIZE', type: 'int', default: 200 },
  { key: 'MAX_RETRIES', type: 'int', default: 5 },
  { key: 'SCAN_READ', type: 'boolean', default: false },
  { key: 'PROCESS_BATCH_SIZE', type: 'int', default: 10 },
  {
    key: 'SCAN_INITIAL_STATE',
    type: 'enum',
    allowedValues: ['new', 'all'],
    default: 'new',
    caseInsensitive: true,
  },
  { key: 'IDLE_WATCHDOG_MS', type: 'int', default: 1200000 },
  // Single-run (<0) / IDLE (0) / poll-every-N-seconds (>0). Read here, not
  // via a direct process.env read at its point of use, so a typo (e.g.
  // "5m") is caught at startup instead of becoming NaN -> setTimeout(NaN)
  // -> a tight poll loop hammering IMAP and rspamd (see the
  // `config-validation` capability).
  { key: 'SCAN_INTERVAL', type: 'int', default: -1 },

  { key: 'LABEL_SPAM_LOW', type: 'string', default: 'Spam:Low' },
  { key: 'LABEL_SPAM_HIGH', type: 'string', default: 'Spam:High' },
  {
    key: 'SPAM_PROCESSING_MODE',
    type: 'enum',
    allowedValues: ['label', 'folder'],
    default: 'folder',
  },

  {
    key: 'RSPAMD_URL',
    type: 'string',
    default: 'http://localhost:11334',
  },
  { key: 'RSPAMD_PASSWORD', type: 'string', default: '', secret: true },
  { key: 'RSPAMD_TIMEOUT_MS', type: 'int', default: 30000 },

  { key: 'SPAM_CLEAN_THRESHOLD', type: 'int', default: 30 },
  { key: 'SPAM_LOW_THRESHOLD', type: 'int', default: 60 },
  { key: 'SPAM_CONFIRMED_THRESHOLD', type: 'int', default: 200 },

  { key: 'AI_ENABLED', type: 'boolean', default: false },
  { key: 'AI_BASE_URL', type: 'string', default: DEFAULT_AI_BASE_URL },
  {
    key: 'AI_API_KEY',
    type: 'string',
    default: '',
    secret: true,
    validate: (value, all) =>
      all.AI_ENABLED && !value && all.AI_BASE_URL === DEFAULT_AI_BASE_URL
        ? 'AI_API_KEY is required when AI_ENABLED=true and AI_BASE_URL is the default OpenAI endpoint (set AI_API_KEY, or point AI_BASE_URL at a provider that needs no key, e.g. a local Ollama instance)'
        : null,
  },
  {
    key: 'AI_MODEL',
    type: 'string',
    default: '',
    // No default that makes sense on its own - fail fast at load time
    // rather than let every AI classification call fail individually once
    // AI is enabled.
    validate: (value, all) =>
      all.AI_ENABLED && !value
        ? 'AI_MODEL is required when AI_ENABLED=true (no default - set it explicitly, e.g. "gpt-4o-mini" or your provider\'s model name)'
        : null,
  },
  { key: 'AI_TIMEOUT_MS', type: 'int', default: 15000 },
  { key: 'AI_MAX_RETRIES', type: 'int', default: 1 },
  { key: 'AI_CONCURRENCY', type: 'int', default: 5 },
  { key: 'AI_MAX_INPUT_TOKENS', type: 'int', default: 6000 },
  { key: 'AI_MAX_OUTPUT_TOKENS', type: 'int', default: 2000 },
  {
    key: 'AI_ESCALATE_TO_LOW_THRESHOLD',
    type: 'int',
    default: 50,
    validate: (value, all) =>
      all.AI_ENABLED && value > all.AI_ESCALATE_TO_HIGH_THRESHOLD
        ? `AI_ESCALATE_TO_LOW_THRESHOLD (${value}) must not exceed AI_ESCALATE_TO_HIGH_THRESHOLD (${all.AI_ESCALATE_TO_HIGH_THRESHOLD})`
        : null,
  },
  { key: 'AI_ESCALATE_TO_HIGH_THRESHOLD', type: 'int', default: 80 },
  { key: 'AI_USER_PROFILE', type: 'string', default: '' },
  { key: 'AI_FAILURE_ALERT_THRESHOLD', type: 'int', default: 3 },
];

function parseValue(entry, raw) {
  if (entry.type === 'int') {
    if (raw === undefined) return entry.default;
    // parseInt() alone would silently truncate trailing garbage (e.g.
    // parseInt('5m', 10) === 5) instead of catching the typo - require the
    // whole (trimmed) string to be an integer.
    return /^-?\d+$/.test(raw.trim()) ? parseInt(raw, 10) : NaN;
  }
  if (entry.type === 'boolean') {
    if (raw === undefined) return entry.default;
    return entry.default === true ? raw !== 'false' : raw === 'true';
  }
  if (entry.type === 'enum') {
    const value = raw === undefined ? entry.default : raw;
    return entry.caseInsensitive ? value.toLowerCase() : value;
  }
  // string
  return raw === undefined ? entry.default : raw;
}

function buildAndValidate() {
  const values = { HOME: homedir(), USER: userInfo().username };
  const errors = [];

  // Pass 1: parse every field with a safe default (skip `required` fields -
  // they have no safe default and are validated only by
  // assertRequiredConfig, see the `config-validation` capability).
  for (const entry of SCHEMA) {
    if (entry.required) continue;
    const raw = process.env[entry.key];
    const value = parseValue(entry, raw);

    if (entry.type === 'int' && Number.isNaN(value)) {
      errors.push(`${entry.key} must be a number (got "${raw}")`);
      continue;
    }
    if (entry.type === 'enum' && !entry.allowedValues.includes(value)) {
      errors.push(
        `${entry.key} must be one of ${entry.allowedValues.join(', ')} (got "${raw}")`
      );
      continue;
    }
    values[entry.key] = value;
  }

  // Required fields with no safe default still get a value on the object
  // (empty string / undefined pass-through) so existing `config.X` call
  // sites keep working - they're just not validated here. See
  // assertRequiredConfig for the real check.
  for (const entry of SCHEMA) {
    if (entry.required) {
      values[entry.key] = process.env[entry.key];
    }
  }

  // Pass 2: cross-field checks, now that every value is known.
  for (const entry of SCHEMA) {
    if (!entry.validate) continue;
    const problem = entry.validate(values[entry.key], values);
    if (problem) errors.push(problem);
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid configuration:\n${errors.map(e => `  - ${e}`).join('\n')}`
    );
  }

  return values;
}

export const config = (() => {
  const c = buildAndValidate();
  logger.debug(c, 'Loading configuration');
  return c;
})();

/**
 * Checks the config fields that have no safe default and must be supplied
 * by the operator (IMAP_HOST/IMAP_USER/IMAP_PASSWORD) - kept separate from
 * the unconditional load-time validation above so importing this module
 * never fails merely because IMAP credentials are absent in an environment
 * that doesn't need them (e.g. a test). Every command-line entry point that
 * connects to IMAP calls this once at startup, before doing any other work.
 * See the `config-validation` capability.
 * @param {Object} [cfg]
 * @throws {Error} listing every missing required field, if any are missing
 */
export function assertRequiredConfig(cfg = config) {
  const missing = SCHEMA.filter(entry => entry.required && !cfg[entry.key]).map(
    entry => entry.key
  );

  if (missing.length > 0) {
    throw new Error(
      `Missing required configuration:\n${missing.map(k => `  - ${k}`).join('\n')}`
    );
  }
}
