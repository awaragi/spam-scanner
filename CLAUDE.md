# spam-scanner

npm-workspaces monorepo for a multi-mailbox IMAP spam scanner. Rspamd is a
stateless content scorer shared across mailboxes over HTTP (`/checkv2`,
`/learnham`, `/learnspam`) and has no list or mailbox awareness.
Whitelist/blacklist matching, scan state, and IDLE orchestration live in app
code. Per-mailbox state (scanner progress, sender lists, settings overrides) is
stored as JSON in that mailbox's own IMAP state folder, not in a local file or
database.

## Layout

- `app/server/` — NestJS server: runs one runner per mailbox and exposes the
  HTTP control API (OpenAPI). Its own `bin/` holds server-specific CLI
  scripts (`generate-env.ts`), imported and tested like the rest of the
  workspace - not to be confused with the repo-root `bin/` below.
- `app/front/` — Angular control UI for the server API.
- `rspamd/` — Rspamd Docker configuration, shared.
- `docker-compose.yml` / `docker-compose.base.yml` — shared compose setup;
  each app's service builds from its own folder.
- `bin/` (repo root) — scripts spanning the whole repo, not tied to one
  workspace (`migrate-bayes-per-user.sh`). `bin/local/` — local dev scripts
  (`server-dev.sh`, `mock-rspamd.mjs`, etc.).
- `openspec/` — the process of record for design/plan/spec work, used via the
  `/opsx:*` slash commands.
- `skills/` — generic, repo-wide skills (e.g. `review-branch`). A skill tied to
  one app belongs in that app's own `skills/` folder. Each skill is mirrored by
  a thin stub under `.claude/skills/<name>/SKILL.md`.

## Server architecture (`app/server/src/`)

Layers, from innermost out. `lint:deps` (dependency-cruiser,
`.dependency-cruiser.cjs`) enforces the direction:

- `domain/` — pure spam-scanner rules and generic utils. Imports nothing else
  from `src/` and nothing from Nest.
- `config/` — the zod env schema (`app-config.schema.ts`), typed config
  sections, and per-mailbox settings defaults/overrides.
- `infrastructure/` — the impure I/O boundary: IMAP (`*.gateway.ts`,
  `*.repository.ts`), rspamd, AI, IMAP-backed state. May use `domain/` and
  `config/`.
- `application/` — orchestration: scan/train/folder services and their steps
  (`*.service.ts`, `*.step.ts`), working on a per-job `MailboxSession`. May use
  `infrastructure/`, `domain/`, and `config/`.
- `runtime/` — `MailboxRunner` (bootstrap, IDLE loop, interval, backoff,
  single-flight jobs) and `RunnerRegistry`.
- `api/` — controllers, guards, DTO schemas. Keep controllers thin.
- `logging/` — bootstrap wiring only. Not a layer, so `api/` can't import it.

## Testing

Write a test only when it would catch a real bug. Coverage is not a goal:
never add a test just to cover a line, method, or file, and don't chase a
coverage number.

**Worth testing:** branching logic, data transformation, error translation
(e.g. an unknown mailbox becoming a 404), cleanup in `finally`, safety ordering
(e.g. append-before-delete on IMAP state), retry/backoff/coalescing, and
security properties (secret redaction, token scoping).

**Don't write:**

- Delegation tests: "X calls mocked Y with the same args and returns its
  result". Thin Nest controllers need no unit test of their own.
- Tests that restate constants or shapes TypeScript already enforces.
- Assertions on log messages.
- The same boilerplate test repeated per method (e.g. "logs and rethrows on
  failure" for every gateway wrapper).
- Tests that duplicate coverage a lower layer already has (e.g. a service
  re-testing a step's filtering).
- Nest module "resolves provider X" tests. `app.module.spec.ts` already
  compiles the whole DI graph.

**How to test each layer:**

- `domain/` — plain inputs and outputs, zero mocks.
- `infrastructure/` — fake the external client (ImapFlow, `fetch`, OpenAI SDK)
  and assert on the adapter's own behavior: request shape, parsing, error
  handling.
- `application/` and `runtime/` — mock only `infrastructure/` modules or
  providers, and use real `domain/` code and real steps. Build sessions and
  config as plain fixture objects, not mocks.
- Shared fakes live in `app/server/test/support/`.

Assert on observable behavior, not internal structure, so refactors don't
force test changes.

## Commands (run inside `app/server/`, or with `-w app/server` from the root)

- `npm test` — unit tests (vitest; specs sit next to their source as
  `*.spec.ts`)
- `npm run lint` — oxlint plus the dependency-cruiser layer check
- `npm run format` / `npm run format:check` — Prettier
- `npm run build` / `npm run start:dev` — Nest build / watch mode
- `npm run generate:env-example` — regenerates `.env.example` from
  `configGroups`. A spec fails if the committed file drifts, so run this
  after changing the schema instead of editing `.env.example` by hand.
- `npm run generate:env -- --input <old> --output <new>` — rewrites an
  existing server env file onto the current schema, keeping its values and
  listing defaulted and unknown keys.
- `npm run lint` / `format` / `format:check` (root) — run across every
  `app/*` workspace (front uses oxlint and Prettier too); CI runs these
- `bin/local/server-dev.sh` — run the server with the repo-root `.env`
- `npm run mock-rspamd` (root) — local stand-in for rspamd
- `npm run front:start` (root) — Angular dev server

## Conventions

- Config comes from `process.env`, validated once at bootstrap by
  `AppConfigModule`. Inject a typed config section; never read `process.env`
  elsewhere.
- Structured logging via pino (`nestjs-pino`). Never log credentials, tokens,
  or email content.
- IMAP operations use UIDs, not sequence numbers. Always log out in a
  `finally` block.
- Prefer Mermaid for diagrams in Markdown docs.
