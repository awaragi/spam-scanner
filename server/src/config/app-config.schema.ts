import { z } from 'zod';

const DEFAULT_AI_BASE_URL = 'https://api.openai.com/v1';

/**
 * One mailbox's connection info, once its `MAILBOX_<n>_*` env slot has been
 * parsed (see `MailboxesSchema` below). Plain data - not a class - since
 * there's no per-field `config.get()` reading to do any more: the whole
 * array comes back from `AppConfigService.get('MAILBOXES', ...)` in one
 * shot, already validated and typed.
 */
export interface MailboxConnectionConfig {
  readonly id: string;
  readonly imapHost: string;
  readonly imapPort: number;
  readonly imapUser: string;
  readonly imapPassword: string;
  readonly imapTls: boolean;
  readonly imapAllowInsecure: boolean;
  readonly stateFolder: string;
  readonly enabled: boolean;
}

/**
 * Explicit, hand-written authoritative type for the merged runtime config -
 * not derived via `z.infer<typeof AppConfigSchema>`. `configGroups.reduce((acc, g)
 * => acc.merge(g.schema), z.object({}))` collapses precise field inference and, worse,
 * makes `z.infer` on the result excessively deep for tsc to resolve. This interface
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
  MAILBOXES: MailboxConnectionConfig[];
}

/**
 * An integer field parsed from a whole (trimmed) integer string, falling
 * back to `defaultValue` when unset (zod's `.default()` short-circuits
 * before this preprocessor runs whenever the raw value is `undefined`).
 * `parseInt()` alone would silently truncate trailing garbage (e.g.
 * `parseInt('5m', 10) === 5`) instead of catching the typo, so an invalid
 * string is passed through unchanged and rejected by zod's own number type
 * check rather than becoming `NaN`.
 */
export function intField(defaultValue: number) {
  return z
    .preprocess(
      (raw: unknown) =>
        /^-?\d+$/.test(String(raw).trim()) ? parseInt(String(raw), 10) : raw,
      z.number().int(),
    )
    .default(defaultValue);
}

/**
 * A boolean field whose parsing depends on its own default: when the
 * default is `true`, only an explicit "false" opts out (e.g.
 * `MAILBOX_IMAP_TLS`); when `false`, only an explicit "true" opts in (e.g.
 * `AI_ENABLED`).
 */
export function boolField(defaultValue: boolean) {
  return z
    .preprocess(
      (raw) => (defaultValue ? raw !== 'false' : raw === 'true'),
      z.boolean(),
    )
    .default(defaultValue);
}

/**
 * Structural type for a config group, so `bin/generate-env.ts`
 * can render `.env.example` from `configGroups`.
 */
export interface ConfigGroupDef {
  title: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  schema: z.ZodObject<any>;
}

/**
 * Rspamd connection - shared by every mailbox (rspamd itself has no mailbox
 * awareness).
 */
const rspamdGroup: ConfigGroupDef = {
  title: 'Rspamd Configuration',
  schema: z.object({
    RSPAMD_URL: z
      .string()
      .default('http://localhost:11334')
      .describe(
        `For Docker deployment: RSPAMD_URL is automatically set to http://rspamd:11334
For local development: Use http://localhost:11334 (when running via bin/local/docker-compose.yml)`,
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
for this when hashing, but only if you escape it here first.`,
      ),
    RSPAMD_TIMEOUT_MS: intField(30000).describe(
      'RSPAMD_TIMEOUT_MS: Abort a stalled rspamd HTTP call (check/learn) after this many ms',
    ),
    RSPAMD_ENVELOPE_TRUSTED_HOPS: intField(0).describe(
      `RSPAMD_ENVELOPE_TRUSTED_HOPS: number of Received: headers (counted from the
top/most recent) added by your mailbox provider's own internal
infrastructure after accepting the message - skipped when resolving the
connecting IP/HELO passed to rspamd for SPF/DNSBL checks. 0 fits most
single-MX setups; increase it if an inbound relay sits in front of the
final IMAP store.`,
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
AI when this app-wide flag AND its own setting both allow it.`,
    ),
    AI_BASE_URL: z
      .string()
      .default(DEFAULT_AI_BASE_URL)
      .describe(
        `AI_BASE_URL: OpenAI-compatible chat-completions base URL.
Works with OpenAI, Ollama (e.g. http://localhost:11434/v1), LM Studio, or any compatible gateway.`,
      ),
    AI_API_KEY: z.string().default(''),
    AI_MODEL: z
      .string()
      .default('')
      .describe(
        `AI_MODEL: required when AI_ENABLED=true - there is no code default. gpt-5-nano is an
example value.`,
      ),
    AI_TIMEOUT_MS: intField(15000).describe(
      'AI_TIMEOUT_MS: per-request timeout (ms) before the SDK aborts the call.',
    ),
    AI_MAX_RETRIES: intField(1).describe(
      'AI_MAX_RETRIES: SDK-level retries on transient failures (timeout, network error, 429/5xx).',
    ),
    AI_CONCURRENCY: intField(5).describe(
      'AI_CONCURRENCY: max concurrent AI requests per scan batch (avoid hammering the provider).',
    ),
    AI_MAX_INPUT_TOKENS: intField(6000).describe(
      `AI_MAX_INPUT_TOKENS: budget for the email body sent to the AI (heuristic: chars = tokens * 4).
Default is generous enough to cover the plain-text body of most spam emails without truncation.`,
    ),
    AI_MAX_OUTPUT_TOKENS: intField(2000).describe(
      `AI_MAX_OUTPUT_TOKENS: max_completion_tokens on the completion request. For reasoning-family
models (o-series, GPT-5, etc.) this budget covers hidden "reasoning tokens" as well as the
visible {"score":.., "reasoning":".."} reply, so keep it generous - a too-small value can
leave zero budget for visible output and cause "Empty response from AI provider" errors.`,
    ),
    AI_FAILURE_ALERT_THRESHOLD: intField(3).describe(
      `AI_FAILURE_ALERT_THRESHOLD: after this many CONSECUTIVE AI classification failures with the
same normalized reason (e.g. repeated auth errors, repeated timeouts), an alert should be raised
so the operator notices - then stay quiet about that same ongoing issue until it recovers (a
success resets the count, so a later recurrence can alert again). Set to -1 to disable alerting
entirely. Note: the alert-email delivery mechanism itself is not part of this change (see
design.md's Non-Goals) - only the threshold is configured here.`,
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
      .refine((value) => value > 0, {
        message:
          'SCAN_INTERVAL must be a positive integer (single-run and IDLE mode are no longer supported - the minimal run loop always polls on a fixed interval, see design.md D9)',
      })
      .describe(
        `SCAN_INTERVAL: seconds between run-loop ticks. Each tick trains
(train-spam/train-ham/train-whitelist/train-blacklist) then scans repeatedly until a pass
processes 0 messages. Must be a positive whole number of seconds. Default: 300`,
      ),
    BATCH_SCAN_SIZE: intField(200).describe(
      `BATCH_SCAN_SIZE: max UIDs fetched from a single mailbox SEARCH per scan cycle - how
many pending messages one cycle considers at all, before any of them are downloaded.
Distinct from BATCH_PROCESS_SIZE below, which then subdivides that set into smaller
batches for fetching/processing. Default: 200`,
    ),
    BATCH_PROCESS_SIZE: intField(10).describe(
      `BATCH_PROCESS_SIZE: max messages fetched/processed together per batch within
a single scan or train run. Distinct from BATCH_SCAN_SIZE above, which caps how many UIDs a
scan cycle considers in total before this smaller per-batch limit subdivides them. Default: 10`,
    ),
    MAX_RETRIES: intField(5).describe(
      `MAX_RETRIES: Maximum consecutive failures before backing off. Reserved for
3-mailbox-runners - the minimal run loop in this change logs a failed job and continues to
the next tick rather than exiting or backing off.`,
    ),
  }),
};

/**
 * Logging is global. Kept permissive (plain strings with defaults) rather
 * than a rejecting enum, since `logging/logging.module.ts` tolerates an
 * invalid value (case-insensitive match, falling back to "info"/"json" with a
 * warning) rather than failing startup - see the `logging-levels`
 * capability.
 */
const loggingGroup: ConfigGroupDef = {
  title: 'Logging Configuration',
  schema: z.object({
    LOG_LEVEL: z
      .string()
      .default('info')
      .describe(
        'LOG_LEVEL: Verbosity of logging (trace, debug, info, warn, error, fatal)\nDefault: info',
      ),
    LOG_FORMAT: z
      .string()
      .default('json')
      .describe(
        `LOG_FORMAT: Output format for logs (json, jsonl, pretty)
Use 'pretty' for human-readable output in development
Use 'json' or 'jsonl' (equivalent aliases) for structured logging in production
Default: json`,
      ),
    LOG_FILTER_INCLUDES: z
      .string()
      .default('')
      .describe(
        `LOG_FILTER_INCLUDES: Comma-delimited list of component names to include in logs
If set, only these components will log. Example: imap,rspamd,scanner
Default: empty (log all components)`,
      ),
    LOG_FILTER_EXCLUDES: z
      .string()
      .default('imapflow')
      .describe(
        `LOG_FILTER_EXCLUDES: Comma-delimited list of component names to exclude from logs
If set, these components will not log. Example: imapflow,config
Default: empty (don't exclude any components)`,
      ),
  }),
};

const serverGroup: ConfigGroupDef = {
  title: 'HTTP Server Configuration',
  schema: z.object({
    PORT: intField(3000).describe(
      'PORT: TCP port the HTTP server listens on. Default: 3000',
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
        'API_ADMIN_PASSWORD: the single admin password checked by POST /auth/login. No default - the server refuses to start without one.',
      ),
    API_JWT_SECRET: z
      .string()
      .min(1)
      .describe(
        'API_JWT_SECRET: HMAC signing secret shared by admin and mailbox tokens. No default - the server refuses to start without one.',
      ),
    API_ADMIN_TOKEN_TTL: intField(3600).describe(
      'API_ADMIN_TOKEN_TTL: seconds an admin token stays valid before re-login is required. Default: 3600 (1h)',
    ),
    API_MAILBOX_TOKEN_TTL: intField(3600).describe(
      'API_MAILBOX_TOKEN_TTL: seconds a mailbox token stays valid before it must be re-exchanged. Default: 3600 (1h)',
    ),
  }),
};

/**
 * `.env.example` documentation only: variables consumed by docker-compose,
 * not by the server. Like `mailboxDocGroup`, it is deliberately NOT merged
 * into `AppConfigSchema`, so the server neither reads nor validates it.
 */
const dockerComposeDocGroup: ConfigGroupDef = {
  title: 'Docker Compose (not read or validated by the server)',
  schema: z.object({
    SPAM_SCANNER_DATA: z
      .string()
      .default('/absolute/path/to/.spam-scanner')
      .describe(
        `SPAM_SCANNER_DATA: used by docker-compose.yml only - the server never reads it.
External data directory bind-mounted for rspamd state, logs and the Redis Bayes corpus.
IMPORTANT: use an absolute path - Docker Compose does not expand ~
Example: SPAM_SCANNER_DATA=/home/youruser/.spam-scanner`,
      ),
  }),
};

/**
 * `.env.example` documentation only. The real mailbox connection info is
 * parsed and validated dynamically (see `MailboxesSchema` below): it scans
 * whatever `MAILBOX_<n>_*` keys are actually present, for however large `n`
 * gets, rather than this schema declaring a fixed set of numbered fields -
 * so there's no hardcoded cap on how many mailboxes a deployment can run.
 * This group exists purely so `bin/generate-env.ts` has a concrete template
 * to render; it is deliberately NOT merged into `AppConfigSchema` (see
 * below), so its fields carry no constraint of their own.
 */
const mailboxDocGroup: ConfigGroupDef = {
  title:
    'Mailbox Connections (MAILBOX_1_* required - every server needs at least one mailbox. Add MAILBOX_2_*, MAILBOX_3_*, ... the same way, with no fixed limit, for more mailboxes)',
  schema: z.object({
    MAILBOX_1_ID: z
      .string()
      .default('')
      .describe(
        `MAILBOX_1_ID: the mailbox owner's email address. Used as the mailbox's id and as its
rspamd user (see the server/mailbox-registry capability) - distinct from MAILBOX_1_IMAP_USER,
which may be a bare username on some providers.`,
      ),
    MAILBOX_1_IMAP_HOST: z
      .string()
      .default('')
      .describe('MAILBOX_1_IMAP_HOST: IMAP server hostname.'),
    MAILBOX_1_IMAP_PORT: z
      .string()
      .default('993')
      .describe('MAILBOX_1_IMAP_PORT: IMAP server port'),
    MAILBOX_1_IMAP_USER: z
      .string()
      .default('')
      .describe('MAILBOX_1_IMAP_USER: IMAP login username.'),
    MAILBOX_1_IMAP_PASSWORD: z
      .string()
      .default('')
      .describe('MAILBOX_1_IMAP_PASSWORD: IMAP login password.'),
    MAILBOX_1_IMAP_TLS: z
      .string()
      .default('true')
      .describe(
        `MAILBOX_1_IMAP_TLS: use TLS for the IMAP connection.
The code's default when this variable is absent is "true". Set it explicitly
to "false" only for a server/port that doesn't support TLS.`,
      ),
    MAILBOX_1_IMAP_ALLOW_INSECURE: z
      .string()
      .default('false')
      .describe(
        `MAILBOX_1_IMAP_ALLOW_INSECURE: required alongside MAILBOX_1_IMAP_TLS=false as an explicit,
deliberate second opt-in. Even with both set, STARTTLS is still enforced (the connection fails
rather than silently falling back to plaintext if the server doesn't support it).`,
      ),
    MAILBOX_1_STATE_FOLDER: z
      .string()
      .default('INBOX.scanner.state')
      .describe(
        `MAILBOX_1_STATE_FOLDER: IMAP folder holding this mailbox's JSON state messages
(scanner progress, whitelist, blacklist) - see the state-manager capability.`,
      ),
    MAILBOX_1_ENABLED: z
      .string()
      .default('true')
      .describe(
        `MAILBOX_1_ENABLED: when "false", the server does not start a runner for this mailbox at
bootstrap. Defaults to enabled when unset. Runtime enable/disable via the API is in-memory only
and does not change this value.`,
      ),
    MAILBOX_2_ID: z
      .string()
      .default('')
      .describe(
        `MAILBOX_2_ID: an optional second mailbox - see MAILBOX_1_ID above for what each field
means. Add MAILBOX_3_*, MAILBOX_4_*, ... the same way for further mailboxes; there is no
fixed limit. Leave every MAILBOX_2_* field unset to skip this slot.`,
      ),
    MAILBOX_2_IMAP_HOST: z
      .string()
      .default('')
      .describe('MAILBOX_2_IMAP_HOST: see MAILBOX_1_IMAP_HOST.'),
    MAILBOX_2_IMAP_PORT: z
      .string()
      .default('993')
      .describe('MAILBOX_2_IMAP_PORT: see MAILBOX_1_IMAP_PORT.'),
    MAILBOX_2_IMAP_USER: z
      .string()
      .default('')
      .describe('MAILBOX_2_IMAP_USER: see MAILBOX_1_IMAP_USER.'),
    MAILBOX_2_IMAP_PASSWORD: z
      .string()
      .default('')
      .describe('MAILBOX_2_IMAP_PASSWORD: see MAILBOX_1_IMAP_PASSWORD.'),
    MAILBOX_2_IMAP_TLS: z
      .string()
      .default('true')
      .describe('MAILBOX_2_IMAP_TLS: see MAILBOX_1_IMAP_TLS.'),
    MAILBOX_2_IMAP_ALLOW_INSECURE: z
      .string()
      .default('false')
      .describe(
        'MAILBOX_2_IMAP_ALLOW_INSECURE: see MAILBOX_1_IMAP_ALLOW_INSECURE.',
      ),
    MAILBOX_2_STATE_FOLDER: z
      .string()
      .default('INBOX.scanner.state')
      .describe('MAILBOX_2_STATE_FOLDER: see MAILBOX_1_STATE_FOLDER.'),
    MAILBOX_2_ENABLED: z
      .string()
      .default('true')
      .describe('MAILBOX_2_ENABLED: see MAILBOX_1_ENABLED.'),
  }),
};

const MAILBOX_INDEX_PATTERN = /^MAILBOX_(\d+)_/;

interface RawMailboxSlot {
  index: number;
  id: string;
  imapHost: string;
  imapPort: string;
  imapUser: string;
  imapPassword: string;
  imapTls: string;
  imapAllowInsecure: string;
  stateFolder: string;
  enabled: string;
}

/**
 * Groups every `MAILBOX_<n>_*` key actually present in the raw environment
 * into one raw slot per index, `1..(highest index seen)` - no fixed limit on
 * how large that index gets. Pure reshaping only, no validation and no real
 * defaulting (an unset field becomes `''`): `MailboxesSchema`'s
 * `superRefine`/`transform` below do the actual validation and type
 * coercion. Keeping this step itself unable to fail matters - zod skips an
 * object's own effects once one of its fields hard-fails type parsing, so if
 * this raised issues itself it could suppress unrelated ones (AI/RSPAMD/etc)
 * elsewhere in `AppConfigSchema`.
 */
function extractMailboxSlots(raw: unknown): RawMailboxSlot[] {
  if (typeof raw !== 'object' || raw === null) {
    return [];
  }
  const env = raw as Record<string, unknown>;
  let maxIndex = 0;
  for (const key of Object.keys(env)) {
    const match = MAILBOX_INDEX_PATTERN.exec(key);
    if (match) {
      maxIndex = Math.max(maxIndex, Number(match[1]));
    }
  }
  const field = (index: number, suffix: string): string => {
    const value = env[`MAILBOX_${index}_${suffix}`];
    return typeof value === 'string' ? value : '';
  };
  const slots: RawMailboxSlot[] = [];
  for (let index = 1; index <= maxIndex; index++) {
    slots.push({
      index,
      id: field(index, 'ID'),
      imapHost: field(index, 'IMAP_HOST'),
      imapPort: field(index, 'IMAP_PORT'),
      imapUser: field(index, 'IMAP_USER'),
      imapPassword: field(index, 'IMAP_PASSWORD'),
      imapTls: field(index, 'IMAP_TLS'),
      imapAllowInsecure: field(index, 'IMAP_ALLOW_INSECURE'),
      stateFolder: field(index, 'STATE_FOLDER'),
      enabled: field(index, 'ENABLED'),
    });
  }
  return slots;
}

const rawMailboxSlotSchema = z.object({
  index: z.number(),
  id: z.string(),
  imapHost: z.string(),
  imapPort: z.string(),
  imapUser: z.string(),
  imapPassword: z.string(),
  imapTls: z.string(),
  imapAllowInsecure: z.string(),
  stateFolder: z.string(),
  enabled: z.string(),
});

/**
 * Every configured mailbox, dynamically discovered from `MAILBOX_<n>_*` env
 * keys with no fixed limit on `n` (`extractMailboxSlots` above finds the
 * highest index actually used). At least one mailbox (slot 1) is required;
 * each slot beyond it is either fully configured or fully unset (never a
 * partial mix), slots are numbered contiguously from 1 with no gaps, ids
 * don't collide, and disabling transport encryption's direct-TLS wrapper
 * still requires the explicit `IMAP_ALLOW_INSECURE` opt-in (see
 * `imap-transport-security` and `config-validation`).
 */
const MailboxesSchema = z
  .array(rawMailboxSlotSchema)
  .superRefine((slots, ctx) => {
    if (slots.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['MAILBOX_1_ID'],
        message:
          'At least one mailbox is required - set MAILBOX_1_ID, MAILBOX_1_IMAP_HOST, MAILBOX_1_IMAP_USER and MAILBOX_1_IMAP_PASSWORD.',
      });
    }

    const seenIds = new Set<string>();
    let previousConfigured = true;
    for (const slot of slots) {
      const idKey = `MAILBOX_${slot.index}_ID`;
      const hostKey = `MAILBOX_${slot.index}_IMAP_HOST`;
      const portKey = `MAILBOX_${slot.index}_IMAP_PORT`;
      const userKey = `MAILBOX_${slot.index}_IMAP_USER`;
      const passwordKey = `MAILBOX_${slot.index}_IMAP_PASSWORD`;
      const tlsKey = `MAILBOX_${slot.index}_IMAP_TLS`;
      const allowInsecureKey = `MAILBOX_${slot.index}_IMAP_ALLOW_INSECURE`;

      const requiredValues = [
        slot.id,
        slot.imapHost,
        slot.imapUser,
        slot.imapPassword,
      ];
      const setCount = requiredValues.filter((value) => value !== '').length;
      const configured = setCount === requiredValues.length;

      if (setCount === 0 && slot.index === 1) {
        ctx.addIssue({
          code: 'custom',
          path: [idKey],
          message:
            'At least one mailbox is required - set MAILBOX_1_ID, MAILBOX_1_IMAP_HOST, MAILBOX_1_IMAP_USER and MAILBOX_1_IMAP_PASSWORD.',
        });
      } else if (setCount > 0 && !configured) {
        // Once any of a slot's required fields is set, every one of them is
        // - report each missing field at its own key (not just at idKey), so
        // e.g. deleting only MAILBOX_1_IMAP_HOST still points the error at
        // MAILBOX_1_IMAP_HOST specifically, same as the old per-field checks.
        const requiredKeys: Array<[string, string]> = [
          [idKey, slot.id],
          [hostKey, slot.imapHost],
          [userKey, slot.imapUser],
          [passwordKey, slot.imapPassword],
        ];
        for (const [key, value] of requiredKeys) {
          if (value === '') {
            ctx.addIssue({
              code: 'custom',
              path: [key],
              message: `${key} is required once any of MAILBOX_${slot.index}_* is set (leave every MAILBOX_${slot.index}_* field unset to skip mailbox ${slot.index} entirely).`,
            });
          }
        }
      }

      if (configured && !previousConfigured) {
        ctx.addIssue({
          code: 'custom',
          path: [idKey],
          message: `Mailbox ${slot.index} is configured but mailbox ${slot.index - 1} is not - mailbox slots must be numbered contiguously starting at MAILBOX_1_*, with no gaps.`,
        });
      }

      if (configured) {
        const portRaw = slot.imapPort.trim();
        if (portRaw !== '' && !/^-?\d+$/.test(portRaw)) {
          ctx.addIssue({
            code: 'custom',
            path: [portKey],
            message: `${portKey} must be a whole number.`,
          });
        }

        if (!z.email().safeParse(slot.id).success) {
          ctx.addIssue({
            code: 'custom',
            path: [idKey],
            message: `${idKey} must be a valid email address.`,
          });
        } else if (seenIds.has(slot.id)) {
          ctx.addIssue({
            code: 'custom',
            path: [idKey],
            message: `${idKey} ("${slot.id}") duplicates another mailbox's id - each mailbox needs a unique id.`,
          });
        } else {
          seenIds.add(slot.id);
        }

        const tls = slot.imapTls !== 'false';
        const allowInsecure = slot.imapAllowInsecure === 'true';
        if (!tls && !allowInsecure) {
          ctx.addIssue({
            code: 'custom',
            path: [allowInsecureKey],
            message: `${allowInsecureKey}=true is required alongside ${tlsKey}=false - disabling IMAP transport encryption must be an explicit, deliberate choice`,
          });
        }
      }

      previousConfigured = configured;
    }
  })
  .transform((slots): MailboxConnectionConfig[] =>
    slots
      .filter((slot) => slot.id !== '')
      .map((slot) => {
        const portRaw = slot.imapPort.trim();
        return {
          id: slot.id,
          imapHost: slot.imapHost,
          imapPort: /^-?\d+$/.test(portRaw) ? parseInt(portRaw, 10) : 993,
          imapUser: slot.imapUser,
          imapPassword: slot.imapPassword,
          imapTls: slot.imapTls !== 'false',
          imapAllowInsecure: slot.imapAllowInsecure === 'true',
          stateFolder: slot.stateFolder || 'INBOX.scanner.state',
          enabled: slot.enabled !== 'false',
        };
      }),
  );

const nonMailboxGroups: ConfigGroupDef[] = [
  rspamdGroup,
  aiGroup,
  scanGroup,
  loggingGroup,
  serverGroup,
  apiGroup,
];

/**
 * Every config group, in `.env.example` file order. Exported so
 * `bin/generate-env.ts` can render `.env.example` directly from it.
 * `dockerComposeDocGroup` and `mailboxDocGroup` are documentation only (see
 * their own doc comments) - real
 * mailbox validation is `MailboxesSchema`, merged into `AppConfigSchema`
 * separately below rather than through this array.
 */
export const configGroups: ConfigGroupDef[] = [
  dockerComposeDocGroup,
  ...nonMailboxGroups,
  mailboxDocGroup,
];

/**
 * Injects a computed `MAILBOXES` key (the raw, ungrouped slots found by
 * `extractMailboxSlots`) into the raw environment before the object schema
 * below ever parses it. This has to wrap the *whole* `AppConfigSchema`, not
 * live as that one field's own schema: a field's schema only ever receives
 * that field's own raw value (`env['MAILBOXES']`, which doesn't exist), never
 * its siblings - `extractMailboxSlots` needs the whole raw environment to
 * find every `MAILBOX_<n>_*` key. Purely a reshape (never raises an issue
 * itself), so it can't suppress unrelated validation elsewhere in the object
 * - see `extractMailboxSlots`'s own doc comment for why that matters.
 */
function withMailboxSlots(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) {
    return raw;
  }
  return {
    ...(raw as Record<string, unknown>),
    MAILBOXES: extractMailboxSlots(raw),
  };
}

/**
 * The merged schema validating the server's entire environment-variable
 * configuration, in one pass, at Nest bootstrap (see `config.module.ts`).
 * `z.object()` only reads the keys it declares, so `nonMailboxGroups`' part
 * of this can be handed `process.env` directly without copying it field by
 * field first - `MAILBOXES` is the one exception, populated dynamically by
 * `withMailboxSlots` above rather than declaring a fixed set of
 * `MAILBOX_<n>_*` keys.
 */
export const AppConfigSchema = z.preprocess(
  withMailboxSlots,
  nonMailboxGroups
    .reduce((acc, group) => acc.merge(group.schema), z.object({}))
    .extend({ MAILBOXES: MailboxesSchema })
    .superRefine((rawData, ctx) => {
      // The `.reduce`/`.merge` chain above collapses zod's own field
      // inference (see the `AppConfig` doc comment above) - `AppConfig` is
      // the authoritative hand-written type for the merged shape.
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
    }),
);
