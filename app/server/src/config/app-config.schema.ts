import { z } from 'zod';

const DEFAULT_AI_BASE_URL = 'https://api.openai.com/v1';

/**
 * Explicit, hand-written authoritative type for the merged runtime config -
 * not derived via `z.infer<typeof AppConfigSchema>`. `configGroups.reduce((acc, g)
 * => acc.merge(g.schema), z.object({}))` collapses precise field inference and, worse,
 * makes `z.infer` on the result excessively deep for tsc to resolve (see the same
 * TypeScript gotcha called out in `terminal/src/lib/core/config.ts`). This interface
 * is the single source of truth for the merged shape instead.
 */
export interface AppConfig {
  RSPAMD_URL: string;
  RSPAMD_PASSWORD: string;
  RSPAMD_TIMEOUT_MS: number;
  RSPAMD_ENVELOPE_TRUSTED_HOPS: number;
  AI_ENABLED: boolean;
  AI_BASE_URL: string;
  AI_API_KEY: string;
  AI_MODEL: string;
  AI_TIMEOUT_MS: number;
  AI_MAX_RETRIES: number;
  AI_CONCURRENCY: number;
  AI_MAX_INPUT_TOKENS: number;
  AI_MAX_OUTPUT_TOKENS: number;
  AI_FAILURE_ALERT_THRESHOLD: number;
  SCAN_INTERVAL: number;
  BATCH_SCAN_SIZE: number;
  BATCH_PROCESS_SIZE: number;
  MAX_RETRIES: number;
  LOG_LEVEL: string;
  LOG_FORMAT: string;
  LOG_FILTER_INCLUDES: string;
  LOG_FILTER_EXCLUDES: string;
  PORT: number;
  API_ADMIN_PASSWORD: string;
  API_JWT_SECRET: string;
  API_ADMIN_TOKEN_TTL: number;
  API_MAILBOX_TOKEN_TTL: number;
  MAILBOX_ID: string;
  MAILBOX_IMAP_HOST: string;
  MAILBOX_IMAP_PORT: number;
  MAILBOX_IMAP_USER: string;
  MAILBOX_IMAP_PASSWORD: string;
  MAILBOX_IMAP_TLS: boolean;
  MAILBOX_IMAP_ALLOW_INSECURE: boolean;
  MAILBOX_STATE_FOLDER: string;
}

/**
 * An integer field parsed from a whole (trimmed) integer string, falling
 * back to `defaultValue` when unset (zod's `.default()` short-circuits
 * before this preprocessor runs whenever the raw value is `undefined`).
 * `parseInt()` alone would silently truncate trailing garbage (e.g.
 * `parseInt('5m', 10) === 5`) instead of catching the typo, so an invalid
 * string is passed through unchanged and rejected by zod's own number type
 * check rather than becoming `NaN`. Ported from `terminal/src/lib/core/config.ts`.
 */
export function intField(defaultValue: number) {
  return z
    .preprocess(
      (raw: unknown) =>
        /^-?\d+$/.test(String(raw).trim()) ? parseInt(String(raw), 10) : raw,
      z.number().int()
    )
    .default(defaultValue);
}

/**
 * A boolean field whose parsing depends on its own default: when the
 * default is `true`, only an explicit "false" opts out (e.g.
 * `MAILBOX_IMAP_TLS`); when `false`, only an explicit "true" opts in (e.g.
 * `AI_ENABLED`). Ported from `terminal/src/lib/core/config.ts`.
 */
export function boolField(defaultValue: boolean) {
  return z
    .preprocess(
      raw => (defaultValue ? raw !== 'false' : raw === 'true'),
      z.boolean()
    )
    .default(defaultValue);
}

/**
 * Structural type for a config group, mirroring
 * `terminal/src/lib/core/config.ts`'s `ConfigGroupDef` so a future generator
 * (task 3.1) can render `.env.example` from `configGroups` the same way
 * `src/cli/generate-env.ts` does today.
 */
export interface ConfigGroupDef {
  title: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: z.ZodObject<any>;
}

/**
 * Rspamd connection - shared by every mailbox (rspamd itself has no mailbox
 * awareness, see the module doc comment in `terminal/src/lib/core/config.ts`).
 */
const rspamdGroup: ConfigGroupDef = {
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
 * The AI provider - global, since the provider (and its credentials/limits)
 * is shared by every mailbox. `AI_USER_PROFILE` (per-mailbox context) and the
 * AI escalation thresholds (per-mailbox behavior) are NOT here: see
 * `mailbox-settings.defaults.ts`.
 */
const aiGroup: ConfigGroupDef = {
  title:
    'AI Classification Configuration (optional safety-net escalation layer on top of rspamd)',
  schema: z.object({
    AI_ENABLED: boolField(false).describe(
      `AI_ENABLED: Re-check rspamd's nonSpam/lowSpam buckets with an LLM to catch false negatives.
When false (default), AI is fully skipped - zero behavior change from rspamd-only scanning.
Per-mailbox opt-out lives in code (mailbox-settings.defaults.ts) - a mailbox only ever uses
AI when this app-wide flag AND its own setting both allow it.`
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
        `AI_MODEL: required when AI_ENABLED=true - there is no code default. gpt-5-nano is an
example value.`
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
    AI_FAILURE_ALERT_THRESHOLD: intField(3).describe(
      `AI_FAILURE_ALERT_THRESHOLD: after this many CONSECUTIVE AI classification failures with the
same normalized reason (e.g. repeated auth errors, repeated timeouts), an alert should be raised
so the operator notices - then stay quiet about that same ongoing issue until it recovers (a
success resets the count, so a later recurrence can alert again). Set to -1 to disable alerting
entirely. Note: the alert-email delivery mechanism itself is not part of this change (see
design.md's Non-Goals) - only the threshold is configured here.`
    ),
  }),
};

/**
 * Scan/train cadence and batch sizes - global (every mailbox on this server
 * runs to the same rhythm for now; per-mailbox scheduling is
 * `3-mailbox-runners`). `SCAN_INTERVAL` is a plain positive-integer poll
 * interval now - single-run (`-1`) and IDLE (`0`) modes are gone (see
 * design.md D9): the minimal loop this change ships always polls.
 */
const scanGroup: ConfigGroupDef = {
  title: 'Scan/Train Configuration',
  schema: z.object({
    SCAN_INTERVAL: intField(300)
      .refine(value => value > 0, {
        message:
          'SCAN_INTERVAL must be a positive integer (single-run and IDLE mode are no longer supported - the minimal run loop always polls on a fixed interval, see design.md D9)',
      })
      .describe(
        `SCAN_INTERVAL: seconds between run-loop ticks. Each tick trains
(train-spam/train-ham/train-whitelist/train-blacklist) then scans repeatedly until a pass
processes 0 messages. Must be a positive whole number of seconds. Default: 300`
      ),
    BATCH_SCAN_SIZE: intField(200).describe(
      `BATCH_SCAN_SIZE: max UIDs fetched from a single mailbox SEARCH per scan cycle - how
many pending messages one cycle considers at all, before any of them are downloaded.
Distinct from BATCH_PROCESS_SIZE below, which then subdivides that set into smaller
batches for fetching/processing. Default: 200`
    ),
    BATCH_PROCESS_SIZE: intField(10).describe(
      `BATCH_PROCESS_SIZE: max messages fetched/processed together per batch within
a single scan or train run. Distinct from BATCH_SCAN_SIZE above, which caps how many UIDs a
scan cycle considers in total before this smaller per-batch limit subdivides them. Default: 10`
    ),
    MAX_RETRIES: intField(5).describe(
      `MAX_RETRIES: Maximum consecutive failures before backing off. Reserved for
3-mailbox-runners - the minimal run loop in this change logs a failed job and continues to
the next tick rather than exiting or backing off.`
    ),
  }),
};

/**
 * Logging is global. Kept permissive (plain strings with defaults) rather
 * than a rejecting enum, since `logging/logging.module.ts` preserves
 * terminal's tolerant fallback behavior for an invalid value (case-insensitive
 * match, falling back to "info"/"json" with a warning) rather than failing
 * startup - see the `logging-levels` capability and
 * `terminal/src/lib/core/logger.ts`.
 */
const loggingGroup: ConfigGroupDef = {
  title: 'Logging Configuration',
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

const serverGroup: ConfigGroupDef = {
  title: 'HTTP Server Configuration',
  schema: z.object({
    PORT: intField(3000).describe(
      'PORT: TCP port the HTTP server listens on. Default: 3000'
    ),
  }),
};

/**
 * HTTP API auth - one admin password and one JWT signing secret, shared by
 * both token types (see design.md D1/D2). Neither has a safe default
 * (same pattern as `MAILBOX_IMAP_PASSWORD`): a server that can't verify
 * an admin login or sign a token should refuse to start rather than run
 * wide open.
 */
const apiGroup: ConfigGroupDef = {
  title: 'HTTP API Auth Configuration',
  schema: z.object({
    API_ADMIN_PASSWORD: z
      .string()
      .min(1)
      .describe(
        'API_ADMIN_PASSWORD: the single admin password checked by POST /auth/login. No default - the server refuses to start without one.'
      ),
    API_JWT_SECRET: z
      .string()
      .min(1)
      .describe(
        'API_JWT_SECRET: HMAC signing secret shared by admin and mailbox tokens. No default - the server refuses to start without one.'
      ),
    API_ADMIN_TOKEN_TTL: intField(3600).describe(
      'API_ADMIN_TOKEN_TTL: seconds an admin token stays valid before re-login is required. Default: 3600 (1h)'
    ),
    API_MAILBOX_TOKEN_TTL: intField(3600).describe(
      'API_MAILBOX_TOKEN_TTL: seconds a mailbox token stays valid before it must be re-exchanged. Default: 3600 (1h)'
    ),
  }),
};

/**
 * The one mailbox's connection info. The `MAILBOX_` prefix marks these keys
 * as the temporary env-backed mailbox registry, not app settings - they go
 * away once mailboxes move to real storage (see design.md D5). Unlike
 * terminal's equivalent `IMAP_*` keys, these have no `assertRequiredConfig`
 * escape hatch: validation now runs once at Nest bootstrap (not at module
 * import), so a field with no safe default can simply be required here.
 */
const mailboxGroup: ConfigGroupDef = {
  title: "The Server's Mailbox Connection",
  schema: z.object({
    MAILBOX_ID: z
      .email()
      .describe(
        `MAILBOX_ID: the mailbox owner's email address. Used as the mailbox's id and as its
rspamd user (see the server/mailbox-registry capability) - distinct from MAILBOX_IMAP_USER,
which may be a bare username on some providers.`
      ),
    MAILBOX_IMAP_HOST: z.string().min(1).describe('MAILBOX_IMAP_HOST: IMAP server hostname'),
    MAILBOX_IMAP_PORT: intField(993).describe('MAILBOX_IMAP_PORT: IMAP server port'),
    MAILBOX_IMAP_USER: z
      .string()
      .min(1)
      .describe('MAILBOX_IMAP_USER: IMAP login username'),
    MAILBOX_IMAP_PASSWORD: z
      .string()
      .min(1)
      .describe('MAILBOX_IMAP_PASSWORD: IMAP login password'),
    MAILBOX_IMAP_TLS: boolField(true).describe(
      `MAILBOX_IMAP_TLS: use TLS for the IMAP connection.
The code's default when this variable is absent is "true". Set it explicitly
to "false" only for a server/port that doesn't support TLS.`
    ),
    // Disabling direct TLS also requires this explicit second opt-in - see
    // the `imap-transport-security` capability.
    MAILBOX_IMAP_ALLOW_INSECURE: boolField(false).describe(
      `MAILBOX_IMAP_ALLOW_INSECURE: required alongside MAILBOX_IMAP_TLS=false as an explicit,
deliberate second opt-in. Even with both set, STARTTLS is still enforced (the connection fails
rather than silently falling back to plaintext if the server doesn't support it).`
    ),
    MAILBOX_STATE_FOLDER: z
      .string()
      .default('INBOX.scanner.state')
      .describe(
        `MAILBOX_STATE_FOLDER: IMAP folder holding this mailbox's JSON state messages
(scanner progress, whitelist, blacklist) - see the state-manager capability.`
      ),
  }),
};

/**
 * Every config group, in `.env.example` file order. Exported so a future
 * generator (task 3.1) can render `.env.example` directly from it, the same
 * way `terminal/src/cli/generate-env.ts` does for `configGroups` there.
 */
export const configGroups: ConfigGroupDef[] = [
  rspamdGroup,
  aiGroup,
  scanGroup,
  loggingGroup,
  serverGroup,
  apiGroup,
  mailboxGroup,
];

/**
 * The merged schema validating the server's entire environment-variable
 * configuration, in one pass, at Nest bootstrap (see `config.module.ts`).
 * `z.object()` only reads the keys it declares, so this can be handed
 * `process.env` directly without copying it field by field first.
 */
export const AppConfigSchema = configGroups
  .reduce((acc, group) => acc.merge(group.schema), z.object({}))
  .superRefine((rawData, ctx) => {
    // The `.reduce`/`.merge` chain above collapses zod's own field
    // inference (see the `AppConfig` doc comment above) - `AppConfig` is the
    // authoritative hand-written type for the merged shape. Ported from the
    // matching subset of terminal's `ConfigSchema.superRefine`
    // (`terminal/src/lib/core/config.ts`).
    const data = rawData as unknown as AppConfig;
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
    // Disabling transport encryption's direct-TLS wrapper must be a deliberate
    // second opt-in, not a bare MAILBOX_IMAP_TLS=false - see
    // `imap-transport-security` and `config-validation`.
    if (!data.MAILBOX_IMAP_TLS && !data.MAILBOX_IMAP_ALLOW_INSECURE) {
      ctx.addIssue({
        code: 'custom',
        path: ['MAILBOX_IMAP_ALLOW_INSECURE'],
        message:
          'MAILBOX_IMAP_ALLOW_INSECURE=true is required alongside MAILBOX_IMAP_TLS=false - disabling IMAP transport encryption must be an explicit, deliberate choice',
      });
    }
  });
