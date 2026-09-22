import { z } from 'zod';
import { rootLogger } from './logger.js';
import { homedir, userInfo } from 'os';

const logger = rootLogger.forComponent('config');

const DEFAULT_AI_BASE_URL = 'https://api.openai.com/v1';

/**
 * An integer field parsed from a whole (trimmed) integer string, falling
 * back to `defaultValue` when unset (zod's `.default()` short-circuits
 * before this preprocessor runs whenever the raw value is `undefined`).
 * `parseInt()` alone would silently truncate trailing garbage (e.g.
 * `parseInt('5m', 10) === 5`) instead of catching the typo, so an invalid
 * string is passed through unchanged and rejected by zod's own number type
 * check rather than becoming `NaN`.
 */
function intField(defaultValue) {
  return z
    .preprocess(
      raw => (/^-?\d+$/.test(String(raw).trim()) ? parseInt(raw, 10) : raw),
      z.number().int()
    )
    .default(defaultValue);
}

/**
 * A boolean field whose parsing depends on its own default: when the
 * default is `true`, only an explicit "false" opts out (e.g. `IMAP_TLS`);
 * when `false`, only an explicit "true" opts in (e.g. `AI_ENABLED`).
 */
function boolField(defaultValue) {
  return z
    .preprocess(
      raw => (defaultValue ? raw !== 'false' : raw === 'true'),
      z.boolean()
    )
    .default(defaultValue);
}

/**
 * Declarative schema for every environment-variable-sourced config field
 * (see the `config-validation` capability) - single source of truth for
 * type, default, and validation. `IMAP_HOST`/`IMAP_USER`/`IMAP_PASSWORD`
 * are deliberately left unvalidated here (plain optional strings): they
 * have no safe default, and validating them unconditionally at module load
 * would make importing this module fail in any environment that doesn't
 * set them (every test file, for one) - see `assertRequiredConfig` below.
 */
const ConfigSchema = z
  .object({
    IMAP_HOST: z.string().optional(),
    IMAP_PORT: intField(993),
    IMAP_USER: z.string().optional(),
    IMAP_PASSWORD: z.string().optional(),
    IMAP_TLS: boolField(true),
    // Disabling direct TLS also requires this explicit second opt-in (checked
    // below) - see the `imap-transport-security` capability.
    IMAP_ALLOW_INSECURE: boolField(false),

    FOLDER_INBOX: z.string().default('INBOX'),
    FOLDER_SPAM: z.string().default('INBOX.spam'),
    FOLDER_SPAM_LOW: z.string().default('INBOX.spam.low'),
    FOLDER_SPAM_HIGH: z.string().default('INBOX.spam.high'),
    FOLDER_TRAIN_SPAM: z.string().default('INBOX.scanner.train.spam'),
    FOLDER_TRAIN_HAM: z.string().default('INBOX.scanner.train.ham'),
    FOLDER_TRAIN_WHITELIST: z.string().default('INBOX.scanner.train.whitelist'),
    FOLDER_TRAIN_BLACKLIST: z.string().default('INBOX.scanner.train.blacklist'),
    FOLDER_STATE: z.string().default('INBOX.scanner.state'),

    STATE_KEY_SCANNER: z.string().default('scanner'),
    STATE_KEY_WHITELIST_MAP: z.string().default('rspamd-whitelist-map'),
    STATE_KEY_BLACKLIST_MAP: z.string().default('rspamd-blacklist-map'),

    SCAN_BATCH_SIZE: intField(200),
    MAX_RETRIES: intField(5),
    SCAN_READ: boolField(false),
    PROCESS_BATCH_SIZE: intField(10),
    SCAN_INITIAL_STATE: z
      .preprocess(
        raw => (typeof raw === 'string' ? raw.toLowerCase() : raw),
        z.enum(['new', 'all'])
      )
      .default('new'),
    IDLE_WATCHDOG_MS: intField(1200000),
    // Single-run (<0) / IDLE (0, the default) / poll-every-N-seconds (>0).
    // Read here, not via a direct process.env read at its point of use, so a
    // typo (e.g. "5m") is caught at startup instead of silently misread (or,
    // for a fully non-numeric value, NaN -> setTimeout(NaN) -> a tight loop
    // hammering IMAP and rspamd) - see the `config-validation` capability.
    SCAN_INTERVAL: intField(0),

    LABEL_SPAM_LOW: z.string().default('Spam:Low'),
    LABEL_SPAM_HIGH: z.string().default('Spam:High'),
    SPAM_PROCESSING_MODE: z.enum(['label', 'folder']).default('folder'),

    RSPAMD_URL: z.string().default('http://localhost:11334'),
    RSPAMD_PASSWORD: z.string().default(''),
    RSPAMD_TIMEOUT_MS: intField(30000),
    // Number of `Received:` headers, counted from the top (most recent),
    // added by the mailbox provider's own internal infrastructure after
    // accepting the message from the outside world - skipped when resolving
    // the connecting IP/HELO for Rspamd's envelope data. 0 fits most
    // single-MX setups; increase it if an inbound relay sits in front of
    // the final IMAP store.
    RSPAMD_ENVELOPE_TRUSTED_HOPS: intField(0),

    SPAM_CLEAN_THRESHOLD: intField(30),
    SPAM_LOW_THRESHOLD: intField(60),
    SPAM_CONFIRMED_THRESHOLD: intField(200),

    AI_ENABLED: boolField(false),
    AI_BASE_URL: z.string().default(DEFAULT_AI_BASE_URL),
    AI_API_KEY: z.string().default(''),
    AI_MODEL: z.string().default(''),
    AI_TIMEOUT_MS: intField(15000),
    AI_MAX_RETRIES: intField(1),
    AI_CONCURRENCY: intField(5),
    AI_MAX_INPUT_TOKENS: intField(6000),
    AI_MAX_OUTPUT_TOKENS: intField(2000),
    AI_ESCALATE_TO_LOW_THRESHOLD: intField(50),
    AI_ESCALATE_TO_HIGH_THRESHOLD: intField(80),
    AI_USER_PROFILE: z.string().default(''),
    AI_FAILURE_ALERT_THRESHOLD: intField(3),
  })
  .superRefine((data, ctx) => {
    // No default that makes sense on its own - fail fast at load time
    // rather than let every AI classification call fail individually once
    // AI is enabled.
    if (data.AI_ENABLED && !data.AI_MODEL) {
      ctx.addIssue({
        code: 'custom',
        path: ['AI_MODEL'],
        message:
          'AI_MODEL is required when AI_ENABLED=true (no default - set it explicitly, e.g. "gpt-4o-mini" or your provider\'s model name)',
      });
    }
    if (
      data.AI_ENABLED &&
      !data.AI_API_KEY &&
      data.AI_BASE_URL === DEFAULT_AI_BASE_URL
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['AI_API_KEY'],
        message:
          'AI_API_KEY is required when AI_ENABLED=true and AI_BASE_URL is the default OpenAI endpoint (set AI_API_KEY, or point AI_BASE_URL at a provider that needs no key, e.g. a local Ollama instance)',
      });
    }
    if (
      data.AI_ENABLED &&
      data.AI_ESCALATE_TO_LOW_THRESHOLD > data.AI_ESCALATE_TO_HIGH_THRESHOLD
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['AI_ESCALATE_TO_LOW_THRESHOLD'],
        message: `AI_ESCALATE_TO_LOW_THRESHOLD (${data.AI_ESCALATE_TO_LOW_THRESHOLD}) must not exceed AI_ESCALATE_TO_HIGH_THRESHOLD (${data.AI_ESCALATE_TO_HIGH_THRESHOLD})`,
      });
    }
    // Disabling transport encryption's direct-TLS wrapper must be a deliberate
    // second opt-in, not a bare IMAP_TLS=false - see `imap-transport-security`.
    if (!data.IMAP_TLS && !data.IMAP_ALLOW_INSECURE) {
      ctx.addIssue({
        code: 'custom',
        path: ['IMAP_ALLOW_INSECURE'],
        message:
          'IMAP_ALLOW_INSECURE=true is required alongside IMAP_TLS=false - disabling IMAP transport encryption must be an explicit, deliberate choice',
      });
    }
  });

/**
 * The config fields with no safe default that must be supplied by the
 * operator - see `assertRequiredConfig` and the `config-validation`
 * capability. A separate schema (rather than folding into `ConfigSchema`
 * above) so these are never enforced merely by importing this module.
 */
const RequiredConfigSchema = z.object({
  IMAP_HOST: z.string().min(1),
  IMAP_USER: z.string().min(1),
  IMAP_PASSWORD: z.string().min(1),
});

function buildAndValidate() {
  // z.object() only reads the keys it declares, ignoring the rest of
  // process.env, so this can be passed directly rather than copied field
  // by field first.
  const result = ConfigSchema.safeParse(process.env);
  if (!result.success) {
    const problems = result.error.issues.map(
      issue => `${issue.path.join('.')}: ${issue.message}`
    );
    throw new Error(
      `Invalid configuration:\n${problems.map(p => `  - ${p}`).join('\n')}`
    );
  }
  return { HOME: homedir(), USER: userInfo().username, ...result.data };
}

export const config = (() => {
  const c = buildAndValidate();
  logger.debug(c, 'Loading configuration');
  if (!c.IMAP_TLS) {
    logger.warn(
      'IMAP_TLS=false - direct-TLS wrapper for the IMAP connection is disabled; STARTTLS is enforced instead (see imap-transport-security)'
    );
  }
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
  const result = RequiredConfigSchema.safeParse(cfg);
  if (!result.success) {
    const missing = [
      ...new Set(result.error.issues.map(issue => issue.path[0])),
    ];
    throw new Error(
      `Missing required configuration:\n${missing.map(k => `  - ${k}`).join('\n')}`
    );
  }
}
