# Proposal

## Why

`src/lib/core/config.js` reads every environment variable ad hoc with no shared schema
(ROADMAP.md 5.10): a bad numeric value is silently misinterpreted or becomes `NaN` instead
of raising an error (verified concretely: `src/cli/orchestrator.js` reads `SCAN_INTERVAL`
directly via `process.env` - bypassing `config.js` entirely, violating CLAUDE.md's "Config
comes from environment variables read once in `src/lib/core/config.js` - never read
`process.env` elsewhere" - and, contrary to the roadmap finding's own description,
`SCAN_INTERVAL=5m` does NOT produce `NaN`: `parseInt('5m', 10) === 5`, since `parseInt`
stops at the first non-digit character rather than rejecting the whole string - so a typo
like `5m` (probably meant as "5 minutes") is silently reinterpreted as "5 seconds" with no
error at all, a worse failure mode than a crash. A truly non-numeric value, e.g.
`SCAN_INTERVAL=abc`, does produce `NaN`: since `NaN < 0` and `NaN === 0` are both `false`,
execution falls into the poll-mode branch and calls `interruptibleSleep(NaN * 1000)`, which
resolves to `setTimeout(fn, NaN)` - Node clamps an invalid delay to ~1ms, producing a tight
loop hammering IMAP and rspamd. Both failure modes - silent misinterpretation of trailing
garbage, and outright `NaN` - are worth catching, and this change's stricter integer
parsing (the whole value must be a valid integer, not just its leading digits) catches
both); `IMAP_PASSWORD` missing produces a cryptic IMAP auth error instead of a clear one;
`SPAM_PROCESSING_MODE` typos aren't caught until the first scan runs, after training
already happened; `AI_ENABLED=true` with no `AI_API_KEY` against the default OpenAI
endpoint isn't caught until API calls start failing; and
`AI_ESCALATE_TO_LOW_THRESHOLD > AI_ESCALATE_TO_HIGH_THRESHOLD` is accepted silently.

## What Changes

- A declarative schema (a plain JS table, not a new dependency - the project has no schema
  library today and this doesn't need one) describes every config var: name, type
  (`string`/`int`/`boolean`/`enum`), default, whether it's required with no safe default,
  allowed values for enums, and a `secret` flag.
- `config.js` validates every field it can safely check at module load (as it already does
  today for `AI_MODEL`-when-enabled and `SCAN_INITIAL_STATE`) and now **collects every
  problem** instead of throwing on the first one - a misconfigured deployment sees the
  complete list of what's wrong in one run, not one error per restart.
- New load-time checks, from the schema: every numeric field is validated as a real integer
  (not silently `NaN`); `SPAM_PROCESSING_MODE` is validated against its two allowed values
  at load, not deferred to the first scan; `AI_API_KEY` is required when `AI_ENABLED=true`
  and `AI_BASE_URL` is still the default OpenAI endpoint (a non-default `AI_BASE_URL`, e.g.
  a local Ollama instance, doesn't need a key); `AI_ESCALATE_TO_LOW_THRESHOLD` must not
  exceed `AI_ESCALATE_TO_HIGH_THRESHOLD`.
- `SCAN_INTERVAL` moves into `config.js`'s schema (as `SCAN_INTERVAL`, validated as
  an integer) instead of being read directly from `process.env` in `orchestrator.js` -
  fixing both the `NaN`-tight-loop bug and the CLAUDE.md convention violation.
- A new explicit `assertRequiredConfig()` export checks the config vars that have **no safe
  default and must be supplied by the operator** (`IMAP_HOST`, `IMAP_USER`,
  `IMAP_PASSWORD`) - kept separate from the load-time checks above specifically so
  importing `config.js` never throws merely because IMAP credentials aren't set in an
  environment that doesn't need them (every test file in `test/unit/` imports `config.js`
  transitively without setting IMAP credentials; forcing that check into the unconditional
  module-load path would break the suite). Every `src/cli/*.js` and `src/admin/*.js` entry
  point calls it once at startup, replacing `orchestrator.js`'s current ad hoc
  `if (!config.IMAP_HOST) {...}` / `if (!config.IMAP_USER) {...}` checks (today the only
  entry point that checks anything) with the same shared, complete check everywhere.
- On failure, both the load-time checks and `assertRequiredConfig()` produce one error
  listing every problem found, not just the first.

## Capabilities

### New Capabilities

- `config-validation`: declarative schema-driven validation of environment-variable-sourced
  configuration - what gets validated when, what "invalid" means per field, and what a
  caller sees when validation fails.

## Impact

- `src/lib/core/config.js`: gains the schema table and validation logic; existing exported
  shape of `config` (the object itself) is unchanged - existing `config.SOMETHING` call
  sites throughout the app don't change.
- `src/cli/orchestrator.js`: drops its ad hoc `IMAP_HOST`/`IMAP_USER` checks and its direct
  `process.env.SCAN_INTERVAL` read in favor of `assertRequiredConfig()` and
  `config.SCAN_INTERVAL`.
- Every other `src/cli/*.js` and `src/admin/*.js` entry point: gains an
  `assertRequiredConfig()` call at startup (most have none today).
- `test/unit/core/config.test.js`: gains coverage for the new checks; one existing test
  ("does not throw when AI_ENABLED=true and AI_MODEL is set") needs `AI_API_KEY` added to
  stay valid under the new AI_API_KEY-required-against-default-endpoint check.
- `.env.example` / `README.md`: no renames - `SCAN_INTERVAL` keeps its name, its
  documentation is unchanged other than noting it's now validated.
- No new dependency, no Docker/compose change, no change to `config`'s runtime shape for
  existing fields.
