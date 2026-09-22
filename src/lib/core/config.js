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
 * Grouped, `.describe()`-annotated config, in `.env.example` section order -
 * single source of truth for type, default, validation, and documentation
 * (see the `config-validation` capability and `src/cli/generate-env-example.js`).
 * Each entry is `{ title, schema, docsOnly? }`. `docsOnly` groups (Docker-only
 * or bootstrap-order-constrained vars - see below) are never merged into the
 * runtime `ConfigSchema`: nothing in the app ever reads `config.<docsOnlyKey>`,
 * they exist purely so `.env.example` can be generated from one array instead
 * of hand-maintained separately. `.describe()` is always chained last (after
 * `.default()`/`.optional()`) so the generator's default-extraction logic
 * (`field._def.defaultValue`) sees a consistent wrapper shape regardless of
 * whether a field has one.
 *
 * `IMAP_HOST`/`IMAP_USER`/`IMAP_PASSWORD` are deliberately left unvalidated
 * here (plain optional strings): they have no safe default, and validating
 * them unconditionally at module load would make importing this module fail
 * in any environment that doesn't set them (every test file, for one) - see
 * `assertRequiredConfig` below.
 */
const dataDirGroup = {
  title:
    'Rspamd Data Directory (Docker only - not read by the application; consumed directly by docker-compose.yml)',
  docsOnly: true,
  schema: z.object({
    SPAM_SCANNER_DATA: z
      .string()
      .default('/absolute/path/to/.spam-scanner')
      .describe(
        `External data directory for rspamd state, logs and Redis Bayes corpus.
IMPORTANT: Use an absolute path — Docker Compose does not expand ~
Example: SPAM_SCANNER_DATA=/home/youruser/.spam-scanner`
      ),
  }),
};

const imapGroup = {
  title: 'IMAP Server Configuration',
  schema: z.object({
    IMAP_HOST: z.string().optional(),
    IMAP_PORT: intField(993),
    IMAP_USER: z.string().optional(),
    IMAP_PASSWORD: z.string().optional(),
    IMAP_TLS: boolField(true).describe(
      `IMAP_TLS: use TLS for the IMAP connection.
The code's default when this variable is absent is "true". Set it explicitly
to "false" only for a server/port that doesn't support TLS.`
    ),
    // Disabling direct TLS also requires this explicit second opt-in (checked
    // below) - see the `imap-transport-security` capability.
    IMAP_ALLOW_INSECURE: boolField(false).describe(
      `IMAP_ALLOW_INSECURE: required alongside IMAP_TLS=false as an explicit,
deliberate second opt-in - configuration fails to load if IMAP_TLS=false
without this also set to "true". Even with both set, STARTTLS is still
enforced (the connection fails rather than silently falling back to
plaintext if the server doesn't support it).`
    ),
    IMAP_NOTIFY_ADDRESS: z
      .string()
      .default('')
      .describe(
        `IMAP_NOTIFY_ADDRESS: email address the scanner sends its own notices to (e.g. the
AI-classification-failure alert). Defaults to IMAP_USER, which works when IMAP_USER is
itself an email address (most providers). Set this explicitly when IMAP_USER is a bare
username instead (e.g. "pierre" on self-hosted Dovecot).`
      ),
  }),
};

const foldersGroup = {
  title: 'IMAP Folders Configuration',
  schema: z.object({
    FOLDER_INBOX: z.string().default('INBOX'),
    FOLDER_SPAM: z.string().default('INBOX.spam'),
    FOLDER_SPAM_LOW: z.string().default('INBOX.spam.low'),
    FOLDER_SPAM_HIGH: z.string().default('INBOX.spam.high'),
    FOLDER_TRAIN_SPAM: z.string().default('INBOX.scanner.train.spam'),
    FOLDER_TRAIN_HAM: z.string().default('INBOX.scanner.train.ham'),
    FOLDER_TRAIN_WHITELIST: z.string().default('INBOX.scanner.train.whitelist'),
    FOLDER_TRAIN_BLACKLIST: z.string().default('INBOX.scanner.train.blacklist'),
    FOLDER_STATE: z.string().default('INBOX.scanner.state'),
  }),
};

const scanGroup = {
  title: 'SCAN Configuration',
  schema: z.object({
    // Single-run (<0) / IDLE (0, the default) / poll-every-N-seconds (>0).
    // Read here, not via a direct process.env read at its point of use, so a
    // typo (e.g. "5m") is caught at startup instead of silently misread (or,
    // for a fully non-numeric value, NaN -> setTimeout(NaN) -> a tight loop
    // hammering IMAP and rspamd) - see the `config-validation` capability.
    SCAN_INTERVAL: intField(0).describe(
      `SCAN_INTERVAL: Controls the run mode. Validated at startup as a whole integer
(e.g. "5m" is rejected, not silently misread) - see the \`config-validation\` capability.
  0  = IDLE mode: event-driven, waits for IMAP EXISTS notifications (the code's
       default when this variable is absent, and the default below)
 -1  = Single-run mode: run once and exit - use this for cron/an external scheduler
 >0  = Poll mode: repeat every N seconds`
    ),
    SCAN_BATCH_SIZE: intField(200).describe(
      `SCAN_BATCH_SIZE: max UIDs fetched from a single mailbox SEARCH per scan cycle - how
many pending messages one cycle considers at all, before any of them are downloaded.
Distinct from PROCESS_BATCH_SIZE below, which then subdivides that set into smaller
batches for fetching/processing. Default: 200`
    ),
    SCAN_READ: boolField(false).describe(
      `SCAN_READ: when false (default), the scan query is restricted to unseen
(\\Seen-unset) messages only. Set to true to also rescan messages already
marked read.`
    ),
    SCAN_INITIAL_STATE: z
      .preprocess(
        raw => (typeof raw === 'string' ? raw.toLowerCase() : raw),
        z.enum(['new', 'all'])
      )
      .default('new')
      .describe(
        `SCAN_INITIAL_STATE: what to do the very first time the scanner runs against a
mailbox with no saved state (i.e. FOLDER_STATE has no state message yet):
  new = start from new mail only, skipping everything already in the inbox (default)
  all = start at the beginning, scanning the entire existing inbox
Only affects the very first run - once state exists, this setting is ignored.
Recommended: set this to "all" for your first run against an existing mailbox,
so nothing already sitting in the inbox is skipped.`
      ),
  }),
};

const batchRetryGroup = {
  title: 'Batch Processing & Retry Configuration',
  schema: z.object({
    PROCESS_BATCH_SIZE: intField(10).describe(
      `PROCESS_BATCH_SIZE: max messages fetched/processed together per batch within
a single scan or train run (used by the scan, train, and sender-list-training
controllers). Distinct from SCAN_BATCH_SIZE above, which caps how many UIDs a scan
cycle considers in total before this smaller per-batch limit subdivides them. Default: 10`
    ),
    MAX_RETRIES: intField(5).describe(
      'MAX_RETRIES: Maximum consecutive failures before exiting (applies to all modes)'
    ),
    IDLE_WATCHDOG_MS: intField(1200000).describe(
      `IDLE_WATCHDOG_MS: only relevant in IDLE mode (SCAN_INTERVAL=0). Re-cycles the
scan/training loop at least this often even with no IMAP EXISTS notification -
guards against a silent connection drop (no error/close event) and doubles
as periodic polling of the training folders, which IDLE itself doesn't watch.
Default: 1200000 (20 minutes). Set to 0 to disable and wait indefinitely.`
    ),
  }),
};

const stateGroup = {
  title: 'State Configuration',
  schema: z.object({
    STATE_KEY_SCANNER: z
      .string()
      .default('scanner')
      .describe(
        `State-message keys within FOLDER_STATE identifying each piece of
per-mailbox JSON state (scanner progress, whitelist, blacklist).`
      ),
    STATE_KEY_WHITELIST_MAP: z.string().default('rspamd-whitelist-map'),
    STATE_KEY_BLACKLIST_MAP: z.string().default('rspamd-blacklist-map'),
  }),
};

const spamProcessingGroup = {
  title: 'Spam Processing Configuration',
  schema: z.object({
    SPAM_PROCESSING_MODE: z
      .enum(['label', 'folder'])
      .default('folder')
      .describe(
        `SPAM_PROCESSING_MODE: Processing strategy (label, folder). Default: folder
- folder: Move messages to spam likelihood folders (FOLDER_SPAM_LOW / FOLDER_SPAM_HIGH) - default,
  recommended: visible in every IMAP client, unlike keyword-based labels below
- label: Apply IMAP keywords (Spam:Low, Spam:High) to messages in place. Not the same as
  Gmail labels (X-GM-LABELS) - many clients (Gmail, most mobile apps) don't surface IMAP
  keywords at all; Thunderbird and some desktop clients do`
      ),
  }),
};

const labelGroup = {
  title: 'Spam Label Configuration (for label mode)',
  schema: z.object({
    LABEL_SPAM_LOW: z.string().default('Spam:Low'),
    LABEL_SPAM_HIGH: z.string().default('Spam:High'),
  }),
};

const thresholdsGroup = {
  title: 'Spam Categorization Thresholds',
  schema: z.object({
    SPAM_CLEAN_THRESHOLD: intField(30).describe(
      `Score-percentage thresholds ((score / required_score) * 100) that decide a
message's tier - clean, low, high, or confirmed (moved to FOLDER_SPAM, skips
AI). A blacklist match is always confirmed regardless of score; a whitelist
match subtracts 20 from the score before this math runs if the sender is
DKIM/DMARC-authenticated, or 5 if not, so severe-enough content can still
confirm a whitelisted sender.
clean -> low boundary. Default: 30`
    ),
    SPAM_LOW_THRESHOLD: intField(60).describe(
      'low -> high boundary. Default: 60'
    ),
    SPAM_CONFIRMED_THRESHOLD: intField(200).describe(
      'high -> confirmed boundary. Default: 200'
    ),
  }),
};

const rspamdGroup = {
  title: 'Rspamd Configuration',
  schema: z.object({
    RSPAMD_URL: z
      .string()
      .default('http://localhost:11334')
      .describe(
        `For Docker deployment: RSPAMD_URL is automatically set to http://rspamd:11334
For local development: Use http://localhost:11334 (when running via bin/local/docker-compose.yml)`
      ),
    RSPAMD_PASSWORD: z
      .string()
      .default('')
      .describe(
        `RSPAMD_PASSWORD: pick your own - never reuse this example value.
After setting it, generate the matching rspamd/config/worker-controller.inc
(gitignored, not shared between installs) by running:
  bin/local/hash-rspamd-password.sh
Re-run it whenever this password changes, then: docker compose restart rspamd
IMPORTANT: if your password contains a literal "$", escape it as "$$".
Docker Compose interpolates .env values wherever they're used (including
env_file), so an unescaped "$" starts what looks like a variable
reference (e.g. "$foo") and gets silently dropped, truncating the
password inside the container. hash-rspamd-password.sh already accounts
for this when hashing, but only if you escape it here first.`
      ),
    RSPAMD_TIMEOUT_MS: intField(30000).describe(
      'RSPAMD_TIMEOUT_MS: Abort a stalled rspamd HTTP call (check/learn) after this many ms'
    ),
    // Number of `Received:` headers, counted from the top (most recent),
    // added by the mailbox provider's own internal infrastructure after
    // accepting the message from the outside world - skipped when resolving
    // the connecting IP/HELO for Rspamd's envelope data. 0 fits most
    // single-MX setups; increase it if an inbound relay sits in front of
    // the final IMAP store.
    RSPAMD_ENVELOPE_TRUSTED_HOPS: intField(0).describe(
      `RSPAMD_ENVELOPE_TRUSTED_HOPS: number of Received: headers (counted from the
top/most recent) added by your mailbox provider's own internal
infrastructure after accepting the message - skipped when resolving the
connecting IP/HELO passed to rspamd for SPF/DNSBL checks. 0 fits most
single-MX setups; increase it if an inbound relay sits in front of the
final IMAP store.`
    ),
  }),
};

/**
 * `logger.js` reads these straight from `process.env` itself rather than
 * through this module, because it has to initialize before `config.js`
 * (this module imports `rootLogger` from `logger.js` to log its own
 * validation result, so the logger can't depend on already-validated
 * config). `docsOnly` here for the same reason as `dataDirGroup`.
 */
const loggingGroup = {
  title: 'Logging Configuration',
  docsOnly: true,
  schema: z.object({
    LOG_LEVEL: z
      .string()
      .default('info')
      .describe(
        'LOG_LEVEL: Verbosity of logging (trace, debug, info, warn, error, fatal)\nDefault: info'
      ),
    LOG_FORMAT: z
      .string()
      .default('json')
      .describe(
        `LOG_FORMAT: Output format for logs (json, jsonl, pretty)
Use 'pretty' for human-readable output in development
Use 'json' or 'jsonl' (equivalent aliases) for structured logging in production
Default: json`
      ),
    LOG_FILTER_INCLUDES: z
      .string()
      .default('')
      .describe(
        `LOG_FILTER_INCLUDES: Comma-delimited list of component names to include in logs
If set, only these components will log. Example: imap,rspamd,scanner
Default: empty (log all components)`
      ),
    LOG_FILTER_EXCLUDES: z
      .string()
      .default('imapflow')
      .describe(
        `LOG_FILTER_EXCLUDES: Comma-delimited list of component names to exclude from logs
If set, these components will not log. Example: imapflow,config
Default: empty (don't exclude any components)`
      ),
  }),
};

const aiGroup = {
  title:
    'AI Classification Configuration (optional safety-net escalation layer on top of rspamd)',
  schema: z.object({
    AI_ENABLED: boolField(false).describe(
      `AI_ENABLED: Re-check rspamd's nonSpam/lowSpam buckets with an LLM to catch false negatives.
When false (default), AI is fully skipped - zero behavior change from rspamd-only scanning.`
    ),
    AI_BASE_URL: z
      .string()
      .default(DEFAULT_AI_BASE_URL)
      .describe(
        `AI_BASE_URL: OpenAI-compatible chat-completions base URL.
Works with OpenAI, Ollama (e.g. http://localhost:11434/v1), LM Studio, or any compatible gateway.`
      ),
    AI_API_KEY: z.string().default(''),
    AI_MODEL: z
      .string()
      .default('')
      .describe(
        `AI_MODEL: required when AI_ENABLED=true - there is no code default, and the process fails
fast at startup if this is unset while AI is enabled. gpt-5-nano is an example value.`
      ),
    AI_TIMEOUT_MS: intField(15000).describe(
      'AI_TIMEOUT_MS: per-request timeout (ms) before the SDK aborts the call.'
    ),
    AI_MAX_RETRIES: intField(1).describe(
      'AI_MAX_RETRIES: SDK-level retries on transient failures (timeout, network error, 429/5xx).'
    ),
    AI_CONCURRENCY: intField(5).describe(
      'AI_CONCURRENCY: max concurrent AI requests per scan batch (avoid hammering the provider).'
    ),
    AI_MAX_INPUT_TOKENS: intField(6000).describe(
      `AI_MAX_INPUT_TOKENS: budget for the email body sent to the AI (heuristic: chars = tokens * 4).
Default is generous enough to cover the plain-text body of most spam emails without truncation.`
    ),
    AI_MAX_OUTPUT_TOKENS: intField(2000).describe(
      `AI_MAX_OUTPUT_TOKENS: max_completion_tokens on the completion request. For reasoning-family
models (o-series, GPT-5, etc.) this budget covers hidden "reasoning tokens" as well as the
visible {"score":.., "reasoning":".."} reply, so keep it generous - a too-small value can
leave zero budget for visible output and cause "Empty response from AI provider" errors.`
    ),
    AI_ESCALATE_TO_LOW_THRESHOLD: intField(50).describe(
      `AI escalation thresholds (0-100 AI spam score). A message can only move to a MORE severe
bucket than rspamd assigned - it is never de-escalated, and AI can never escalate as far
as "spam" (that stays reserved for rspamd's own confident verdict).
nonSpam -> lowSpam`
    ),
    AI_ESCALATE_TO_HIGH_THRESHOLD: intField(80).describe(
      'nonSpam/lowSpam -> highSpam (the most AI can reach)'
    ),
    AI_USER_PROFILE: z
      .string()
      .default('')
      .describe(
        `AI_USER_PROFILE: optional free-text context about the mailbox owner, injected into the
prompt to personalize classification (e.g. "I'm married, don't flag dating spam as extra safe").`
      ),
    AI_FAILURE_ALERT_THRESHOLD: intField(3).describe(
      `AI_FAILURE_ALERT_THRESHOLD: after this many CONSECUTIVE AI classification failures with the
same normalized reason (e.g. repeated auth errors, repeated timeouts), post one alert message
to INBOX so the mailbox owner notices - then stay quiet about that same ongoing issue until it
recovers (a success resets the count, so a later recurrence can alert again). Set to -1 to
disable alerting entirely. This tracker is in-memory only and resets on every process restart,
so in single-run/cron mode (SCAN_INTERVAL=-1) a low-volume mailbox may need several runs before
the threshold is reached during a sustained outage; it is most useful in the default IDLE mode
(SCAN_INTERVAL=0) or poll mode, where the process stays running across scan cycles.`
    ),
  }),
};

/**
 * Every config group, in `.env.example` file order. Exported so
 * `src/cli/generate-env-example.js` can render `.env.example` directly from
 * it - see the module doc comment above for what `docsOnly` means.
 */
export const configGroups = [
  dataDirGroup,
  imapGroup,
  foldersGroup,
  scanGroup,
  batchRetryGroup,
  stateGroup,
  spamProcessingGroup,
  labelGroup,
  thresholdsGroup,
  rspamdGroup,
  loggingGroup,
  aiGroup,
];

const ConfigSchema = configGroups
  .filter(group => !group.docsOnly)
  .reduce((acc, group) => acc.merge(group.schema), z.object({}))
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
    // The AI-failure alert needs a real To: address. IMAP_USER covers this
    // for most providers (it's an email address); a bare-username IMAP_USER
    // (e.g. self-hosted Dovecot) has no safe default, so IMAP_NOTIFY_ADDRESS must
    // be set explicitly - but only once AI is actually enabled, since that's
    // the only path that sends this alert.
    if (
      data.AI_ENABLED &&
      !data.IMAP_NOTIFY_ADDRESS &&
      !(data.IMAP_USER && data.IMAP_USER.includes('@'))
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['IMAP_NOTIFY_ADDRESS'],
        message:
          'IMAP_NOTIFY_ADDRESS is required when AI_ENABLED=true and IMAP_USER is not an email address (used as the To: address for the AI-classification-failure alert)',
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
