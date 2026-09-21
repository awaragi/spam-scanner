# spam-scanner

Node.js (ESM) IMAP spam scanner. Rspamd is a stateless content scorer shared across
mailboxes via HTTP (`/checkv2`, `/learnham`, `/learnspam`) — it has no list or mailbox
awareness. Whitelist/blacklist matching, scan state, and IDLE orchestration all live in
app code; per-mailbox state (scanner progress, whitelist, blacklist) is stored as JSON in
that mailbox's own IMAP state folder, not a local file or database.

## Project structure

- `src/cli/` — top-level entry scripts (`orchestrator.js`, `scan-inbox.js`, `train-*.js`,
  `init-folders.js`)
- `src/admin/` — maintenance scripts (export/import list and mailbox state)
- `src/lib/core/` — platform/bootstrap concern, not one of the four layers below:
  `config.js` (reads `process.env`), `context.js` (`createDefaultContext()`, builds the
  `ctx` object threaded through controllers), `logger.js` (imported ambiently everywhere)
- `src/lib/utils/` — pure, generic, no domain knowledge: `*.util.js`, 100% unit tested,
  zero mocks, never sees `ctx`
- `src/lib/services/` — pure, spam-scanner domain rules: `*.service.js`, 100% unit
  tested, zero mocks, never takes `ctx` as a parameter
- `src/lib/clients/` — the impure I/O boundary: `*.client.js` (IMAP/rspamd/AI/state),
  reads `config.js` directly rather than `ctx`, mocked freely in controller tests
- `src/lib/controllers/workflows/` — top-level orchestrator-invoked entry points (scan,
  train, init, idle, etc.): `*.controller.js`, take `ctx` as a trailing parameter
  defaulted to `createDefaultContext()`
- `src/lib/controllers/steps/` — smaller reusable units a workflow controller calls to
  do one thing against one external system: `*.step.js`
- `test/unit/` — mirrors `src/lib/`'s structure (`controllers/workflows/`,
  `controllers/steps/`, `services/`, `utils/`, `clients/`, `admin/`)
- `test/support/` — shared fixtures/fake-client factories used by both `test/unit/` and
  `test/integration/`
- `test/integration/` — hits a real AI provider, run separately via
  `npm run test:integration`
- `bin/` — shell scripts for local and Docker startup
- `rspamd/` — Rspamd Docker configuration
- `openspec/` — spec-driven change process (specs, active/archived changes); the
  project's process of record for design/plan/spec work

## Architecture invariants

- Layer dependencies flow one way: `controllers` → `services`/`clients` → `utils`/`core`.
  A service or util must never import a client or controller.
- `services/` and `utils/` never take `ctx` — a controller extracts the specific value a
  service/util needs and passes it explicitly.
- `clients/` read `config` directly rather than `ctx`, since they're the I/O boundary and
  own their own connection/config concerns.
- `controllers/workflows/*.controller.js` take `ctx` as a trailing parameter defaulted to
  `createDefaultContext()`, so standalone `src/cli/*.js` scripts and the orchestrator can
  call them identically.
- Standalone `src/cli/*.js` scripts follow the same pattern: `newClient()` → `connect()`
  → run the workflow → `safeLogout()` in a `finally` block.

## Testing

- `npm test` runs unit tests (`test/unit/**`); `npm run test:integration` runs
  `test/integration/**` against a real AI provider (loads `.env` via `env-cmd`).
- A controller test mocks only the `*.client.js` modules it needs (transitively) and
  builds `ctx` as a plain object literal via `test/support/fixtures.js`'s
  `fixtureContext()` — never mocked.
- `services/` and `utils/` tests are 100% unit tested with zero mocks.

## Commands

- `npm test` — run unit tests (vitest)
- `npm run test:coverage` — run unit tests with coverage (v8 provider); writes
  `coverage/index.html` (gitignored)
- `npm run test:integration` — run integration tests against a real AI provider
- `npm run format` / `npm run format:check` — Prettier write/check
- `npm run lint` — ESLint (`eslint.config.js`, flat config); reports only, not
  wired into a `--fix` script or CI yet
- `bin/local/start.sh <env-file> [script]` — run a script locally with `.env` loaded
  (defaults to `src/cli/orchestrator.js`)

## Conventions

- Structured logging via `pino` through `rootLogger.forComponent(name)`; never log
  credentials or email content.
- IMAP operations use UIDs, not sequence numbers; always safely close/logout connections in a
  `finally` block.
- Config comes from environment variables read once in `src/lib/core/config.js` — never
  read `process.env` elsewhere.
- Prefer Mermaid for diagrams in Markdown docs (renders inline, version-controlled).
- Document new environment variables in `.env.example` alongside `README.md`.
