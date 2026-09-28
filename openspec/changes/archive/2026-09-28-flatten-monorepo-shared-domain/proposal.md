# Proposal

## Why

`app/server/bin/eval-prompt.ts` runs a full `nest build` before every offline
prompt-eval run just so its own imports resolve, because `src/`'s internal
`.js`-specifier imports can't be resolved by Node's native TS stripping
without a prior build - while `app/server/bin/generate-env.ts` imports
straight from `src/` instead, inconsistently. `app/server/src/domain/` is
already fully framework-free (zero `@nestjs` imports), so it doesn't need to
sit inside the Nest app at all; extracting it into its own Vite-built package
gives every CLI script (present and future) clean, pre-built ESM output to
import, with no build-tool coupling and no more dist-vs-src inconsistency.

Doing this well requires flattening `app/*` back to the repo root at the same
time: a `shared` package needs to sit alongside `server`/`front`, not nested
under a level (`app/`) that existed only to make room next to `terminal/` -
and `terminal/` itself has now reached the parity the original monorepo
restructure was waiting for, so this is also the moment to delete it and add
Turborepo as the task runner across the three real packages left.

## What Changes

- **BREAKING** (internal, no external API change): `git mv app/server server`,
  `git mv app/front front`. Root `workspaces` becomes an explicit
  `["server", "front", "shared"]` (not a glob).
- Extract `server/src/domain/` to a new root `shared/` package (`git mv`,
  tests included), built with Vite in library mode (ESM + `.d.ts`). `server`'s
  `application/`/`infrastructure/` code and root `bin/` scripts depend on it
  as a real package instead of reaching into `dist/` or raw `src/`.
- Consolidate CLI scripts into a root `bin/`: `git mv` `server/bin/eval-prompt.ts`
  and `server/bin/generate-env.ts` there, alongside the existing
  `bin/migrate-bayes-per-user.sh` and `bin/local/*`. Root `package.json` gains
  explicit devDependencies (`yargs`, `dotenv`, `mailparser`, `openai`, `zod`)
  for what these scripts need, run directly against `shared`'s build output -
  no more `nest build` prefix on `eval-prompt`.
- Delete `terminal/` entirely. Its remaining CLI/admin surface is already
  superseded by `server`'s HTTP API (state read/write/reset/export/import via
  `GET/PUT/DELETE mailbox/state`, list export/import via
  `GET/PUT mailbox/lists/:kind`, job triggers via
  `POST mailbox/jobs/:job/trigger`, mailbox listing via `GET admin/mailboxes`)
  or by `MailboxRunner`'s own bootstrap (folder init). Two debug-only scripts
  with no API equivalent (`admin/read-email.ts`, `admin/uid-on-date.ts`) are
  dropped, not ported - to be rewritten against `shared` only if the need
  resurfaces.
- Add `turbo.json` at the root, wiring existing `build`/`test`/`lint`/`format`/
  `format:check` scripts as pipeline tasks across `server`/`front`/`shared`,
  with `shared`'s build as an upstream `dependsOn: ["^build"]` for `server`.
  Local caching only.
- Rewrite `CLAUDE.md` (Layout, Server architecture, Commands sections) and
  `README.md` to describe the new root-level layout, `shared` as the domain
  layer's new home, and Turbo as the task runner. Drop all `app/*` and
  `terminal/` references.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

_None._ This is a structural/tooling refactor: directory layout, build
orchestration, and deletion of already-superseded code. No capability's
observable behavior (API contracts, scanning/orchestration/state/list
semantics, compose isolation properties) changes - `server` already
implements everything `terminal/` did that's worth keeping, confirmed by
comparing `terminal/`'s remaining CLI/admin scripts against `server`'s current
controllers. This change sets `skip_specs: true`.

## Impact

- **Paths:** every reference to `app/server`/`app/front` across
  `docker-compose.yml`, `docker-compose.base.yml`, `server/Dockerfile`,
  `.github/workflows/ci.yml`, `.dependency-cruiser.cjs`, `CLAUDE.md`,
  `README.md`, `openspec/config.yaml`, and the `prompt-engineer` skill's paths
  (`server/skills/prompt-engineer/SKILL.md` + its `.claude/skills/` stub).
- **Build:** `.dependency-cruiser.cjs` scope narrows from `app/server/src` to
  `server/src` and drops `domain/` as an internally-linted layer (now an
  external package boundary enforced by npm's dependency graph). New
  `shared/vite.config.ts` (or `.mts`) for the library build.
  `server/package.json`'s `generate:env*`/`eval-prompt` scripts move to root
  `package.json`.
- **Removed:** `terminal/` (directory, its own `package.json`/lockfile
  entries, `node_modules`, Dockerfile, and any compose/CI references to it -
  already none live in `docker-compose.yml` today).
- **Dependencies:** root `package.json` gains `yargs`, `dotenv`, `mailparser`,
  `openai`, `zod` as explicit devDependencies; `turbo` as a devDependency.
