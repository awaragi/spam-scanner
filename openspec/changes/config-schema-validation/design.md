# Design

## Context

See proposal.md - Why. Relevant current-code details gathered while scoping this change:

- `src/lib/core/config.js` is a self-invoking function that builds a plain `config` object
  from `process.env`, runs two conditional checks today (`AI_MODEL` required when
  `AI_ENABLED`; `SCAN_INITIAL_STATE` enum), and throws on the first failure. It's imported,
  unmocked, by every `src/lib/clients/*.js` file and every `src/cli/*.js`/`src/admin/*.js`
  entry point.
- `test/unit/core/config.test.js` already exercises "throws at load time" behavior with
  `vi.resetModules()` + a controlled `process.env`, proving import-time throwing is an
  established, tested pattern here - not something this change introduces.
- Critically, **no test file sets `IMAP_HOST`/`IMAP_USER`/`IMAP_PASSWORD`** in `process.env`
  before importing `config.js` (directly or transitively, e.g. via `rspamd.client.js`).
  Roughly 15 test files under `test/unit/clients/` and `test/unit/controllers/` import a
  real, unmocked `config.js`. Any unconditional "IMAP_HOST must be set" check at module
  load would break all of them.
- `src/cli/orchestrator.js` is the only entry point that checks anything today
  (`IMAP_HOST`/`IMAP_USER`, not `IMAP_PASSWORD`), and reads `SCAN_INTERVAL` directly from
  `process.env`, bypassing `config.js` - confirmed as a real bug (see proposal.md - Why),
  not just a style violation.
- No schema-validation library (`zod`, `envalid`, etc.) is a current dependency. The
  project's existing dependency list (`imapflow`, `mailparser`, `openai`, `pino`, `yargs`)
  favors direct, unabstracted code for anything not already needing a library it already
  has.

## Goals / Non-Goals

**Goals:**

- Fix the concrete `SCAN_INTERVAL` `NaN`-tight-loop bug and the CLAUDE.md convention
  violation it comes from.
- Give every entry point (not just `orchestrator.js`) the same complete, one-shot
  "everything that's wrong" check for operator-supplied required fields.
- Catch the specific misconfigurations ROADMAP.md 5.10 names (numeric `NaN`, invalid
  `SPAM_PROCESSING_MODE`, missing `AI_API_KEY` against the default endpoint, inverted AI
  thresholds) at load time instead of at first use.
- Keep `config.js`'s exported shape (the `config` object, its field names and values)
  unchanged for every existing call site - this is a validation change, not a config-shape
  change.

**Non-Goals:**

- Not adopting a schema-validation library. A hand-rolled table covers every check this
  change needs; introducing a dependency for it would be the "abstraction beyond what the
  task requires" the project's own conventions warn against.
- Not implementing `loadConfig(env)` as a function callers invoke with a custom env object,
  and not refactoring `ai.client.js`'s import-time `OpenAI` client construction into a
  factory. ROADMAP.md 5.10's recommendation mentions both, but neither is needed to fix the
  bugs this change targets, and both would mean touching every client module's construction
  pattern - a separable, larger architectural change better scoped on its own if the project
  later wants it (e.g. to run the app against multiple mailboxes, ROADMAP.md 5.28, which
  would actually need it).
- Not renaming any environment variable (including `SCAN_INTERVAL`) - fixing the bug and
  the layering violation doesn't require a rename, and a rename would silently break
  existing deployments' `.env` files (the old name simply stops being read).
- Not adding config vars beyond what's already read today (e.g. not introducing
  `IMAP_ALLOW_INSECURE`, ROADMAP.md 5.18 - separate finding, separate change).
- Not wiring the schema's future `secret` flag into `logger.js`'s hardcoded pino `redact`
  list - that list already exists and works; unifying the two isn't needed to fix any bug
  here and would touch unrelated logger.js code.

## Decisions

**Two validation entry points, not one, split by whether the field has a safe default.**
`config.js` keeps validating everything with a safe default (or conditional-on-a-defaulted
field) unconditionally at module load, exactly as it already does for `AI_MODEL`/
`SCAN_INITIAL_STATE` today. A new `assertRequiredConfig(cfg = config)` export handles only
the fields with **no** safe default (`IMAP_HOST`, `IMAP_USER`, `IMAP_PASSWORD`) and must be
called explicitly. This isn't an arbitrary split for test convenience - it's a real
distinction: a field with a default always produces a valid config even with nothing set in
the environment (useful for tests, admin tools, or any future dry-run tooling that doesn't
need live IMAP access), while a field with no default can never be "valid" without operator
input, so asserting it can only make sense as something a real entry point chooses to do
before it tries to use that value.
_Alternative considered_: making `assertRequiredConfig` run automatically whenever
`config.js` is imported, gated by a `SPAM_SCANNER_SKIP_REQUIRED_CHECK` env var tests would
set. Rejected: it inverts the actual safety property (a test suite silencing a real check
via an escape hatch is worse than a check that was never unconditional to begin with), and
it would require every test file to set that var, whereas the chosen design requires zero
test changes for files that don't test validation directly.

**Schema shape**: an array of entries `{ key, type, default, required, allowedValues,
secret, description }` where `type` is `'string' | 'int' | 'boolean' | 'enum'`,
`required: true` marks a field with no safe default (validated only by
`assertRequiredConfig`), and a field can carry an optional `validate(value, allValues)`
function for the handful of cross-field/conditional checks (`AI_MODEL`-when-enabled,
`AI_API_KEY`-when-enabled-against-default-endpoint, threshold ordering) that don't reduce
to type/default/enum alone. This mirrors the shape the roadmap's own recommendation
describes ("type, default, allowed values, description, `secret: true`") without adopting a
library to get it.

**Error aggregation**: both `config.js`'s module-load validation and
`assertRequiredConfig()` collect problems into an array of `{ field, message }` and throw
one `Error` whose message joins them with newlines (matching the existing single-line
`throw new Error(...)` style elsewhere in the codebase - no new error-formatting
convention). `logger.error` isn't used for this because the error is thrown, not logged -
callers (`process.on('unhandledRejection')`-style top-level handling, or a plain try/catch
around the entry point's startup) decide how to surface it; several `src/cli/*.js` scripts
currently have no top-level error handling at all beyond letting Node print the uncaught
exception, which already prints an `Error`'s full message including newlines legibly.

**`assertRequiredConfig()` call sites**: added at the top of every `src/cli/*.js` and
`src/admin/*.js` file, immediately after the `config.js` import and before any other
top-level code (mirroring where `orchestrator.js`'s existing checks live today).
`scan-inbox.js` (and any other entry point that doesn't currently import `config.js` at
all) gains the import specifically to call this.

## Risks / Trade-offs

**[Risk] Splitting validation into two calls could be forgotten by a future entry
point.** A new `src/cli/some-new-script.js` that connects to IMAP but forgets to call
`assertRequiredConfig()` would fail with the same cryptic IMAP-library error this change is
meant to eliminate, just for that one new script. → Mitigation: this is the same risk any
convention-based (not compiler-enforced) check carries in a small codebase without a
plugin/lint rule for it; CONTRIBUTING.md's "Standalone `src/cli/*.js` scripts follow the
same pattern" note (from CLAUDE.md) is the existing precedent this change extends, and a
code reviewer checking new entry points against that pattern is the existing safety net,
not a new one this change needs to invent.

**[Risk] Aggregated multi-line error messages are less familiar than the codebase's
existing single-condition `throw new Error(...)` calls.** → Mitigation: the format is still
a single `Error` with a `.message` string - nothing about how errors propagate or get
caught changes, only that one thrown error can describe multiple problems joined by
newlines. Existing `try/catch`/`.catch()` handling elsewhere in the codebase needs no
changes to keep working.

## Migration Plan

No data migration. Deploys as an ordinary code change. Two behavior changes an existing
deployment could notice on upgrade:

1. A deployment with `SCAN_INTERVAL` set to a non-numeric value (previously silently
   tight-looping) will now fail fast at startup with a clear error instead of running in a
   degraded state - this is the intended fix, not a regression, but worth calling out since
   it changes a previously-"working" (if badly-behaved) deployment into a startup failure
   until `SCAN_INTERVAL` is corrected.
2. `admin/*.js` scripts that previously ran without any `IMAP_HOST`/`IMAP_USER`/
   `IMAP_PASSWORD` check (most of them) will now fail fast with a clear message if those
   are unset, instead of failing later with a less clear IMAP-library error - again the
   intended fix.

No rollback concerns beyond reverting the commit.
