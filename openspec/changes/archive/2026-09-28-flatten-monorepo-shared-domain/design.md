# Design

## Context

See proposal.md - Why/What Changes for motivation. Current state this design
starts from:

- Root `package.json`: `"workspaces": ["app/*"]`, no `turbo.json`, no shared
  package. `app/server` and `app/front` are the only two workspace members;
  `terminal/` (a separate, non-workspace `package.json`) still holds a handful
  of unported admin/CLI scripts.
- `app/server/src/domain/` (`ai/`, `classification/`, `scanning/`,
  `sender-lists/`, `state/`, `utils/`) has zero `@nestjs` imports - confirmed
  by grep across the whole folder.
- `app/server/.dependency-cruiser.cjs` encodes the layer direction
  `api -> runtime -> application -> infrastructure -> domain -> config` (each
  may also use itself) via `forbidden` rules keyed on `^src/<layer>` path
  prefixes, plus a `domain-is-pure` rule forbidding `src/domain` from
  importing any other `^src/*` path.
- `app/server/bin/generate-env.ts` imports `configGroups` from
  `../src/config/app-config.schema.ts` directly (works today: that file's
  only import is `zod`, so Node's native TS stripping resolves it fine) and
  `diffEnvValues`/`renderEnvFile` from `../src/domain/utils/env-file.ts`.
  `app/server/bin/eval-prompt.ts` instead imports from `../dist/domain/...`
  because the modules it needs sit deeper in `src/`'s internal `.js`-specifier
  import graph, which native TS stripping can't resolve without a prior
  `nest build`.
- `terminal/`'s remaining CLI/admin scripts are superseded by `server`'s
  existing controllers (`mailbox.controller.ts`, `admin.controller.ts`) or by
  `MailboxRunner`'s bootstrap - verified route-by-route against
  `terminal/src/cli/*` and `terminal/src/admin/*` during exploration. Two
  debug-only scripts (`read-email.ts`, `uid-on-date.ts`) have no equivalent
  and are being dropped, not ported (confirmed with the user).

## Goals / Non-Goals

**Goals:**
- One real source of truth for domain logic (`shared`), buildable and
  importable the same way from `server`, root `bin/` scripts, and (via a
  normal Vite build) with no dependency on Nest's build pipeline.
- Root-level `server`/`front`/`shared` layout with an explicit workspaces
  list, `terminal/` gone, Turbo driving `build`/`test`/`lint`/`format` across
  the three packages with local caching.
- Preserve file history on every move (`git mv`, never delete+recreate).
- Zero behavior change: same API surface, same scan/train/state semantics,
  same compose isolation properties.

**Non-Goals:**
- Republishing or externally distributing `shared` - it stays a private,
  unpublished workspace package (`"private": true`, matching `server`/`front`).
- Remote Turbo caching / CI cache wiring - local caching only, revisit later
  if build times justify it.
- Moving `infrastructure/`, `application/`, `runtime/`, `api/`, or `config/`
  out of `server` - only `domain/` moves; it's the one layer that was already
  fully framework-free.
- Re-adding any of `terminal/`'s superseded CLI/admin scripts "just in case" -
  the API comparison already showed they're redundant.

## Decisions

### D1: `shared` package boundary = exactly today's `domain/`

`server/src/domain/` moves wholesale (all six subfolders, all `.spec.ts`
files) to `shared/src/`. Nothing from `config/`, `infrastructure/`,
`application/`, `runtime/`, or `api/` moves.

Alternative considered: also move `config/app-config.schema.ts` (it's a pure
zod schema, arguably as framework-free as `domain/`). Rejected - config
defines *this app's* deployment surface (env var names, per-mailbox setting
overrides); it's not generic reusable logic the way `domain/` is, and
CLAUDE.md already treats `config/` as its own layer above `domain/`. Keeping
it in `server` also means `server`'s own layering (config -> infrastructure ->
application -> runtime -> api) is otherwise untouched by this change - only
its bottom layer moved out.

### D2: Package `exports` map by subfolder, not one barrel

`shared/package.json` declares one `exports` subpath per top-level
`domain/` folder (`./ai`, `./classification`, `./scanning`, `./sender-lists`,
`./state`, `./utils`), each backed by its own Vite library entry
(`shared/src/ai/index.ts` re-exporting that folder's public surface, etc.),
built to `shared/dist/<folder>/index.js` + matching `.d.ts`.

Alternative considered: a single `index.ts` barrel re-exporting everything,
imported as `from 'shared'`. Rejected - six unrelated subfolders funneled
through one barrel invites name collisions as they grow, loses the current
per-file import specificity (`from '../domain/utils/concurrency'` becomes
`from 'shared/utils'`, not `from 'shared'`), and forces every consumer to
pull in Vite's single combined chunk instead of just the subfolder it needs.

### D3: Root `bin/` scripts use explicit root devDependencies, not workspace hoisting

Root `package.json` gets `yargs`, `dotenv`, `mailparser`, `openai`, `zod` as
explicit devDependencies (matching exactly what `eval-prompt.ts` and
`generate-env.ts` import today). Root `bin/generate-env.ts` keeps its direct
relative import into `server/src/config/app-config.schema.ts` (unchanged
target file, just a longer relative path since `bin/` is no longer inside
`server/`) rather than routing through a package export - that file's only
import is `zod`, so it resolves under native TS stripping the same way it
does today; no export surface needs to be added to `server`'s `package.json`
for a single private script's sake.

Alternative considered: give `server` a public `exports` entry for its config
schema, and have root `bin/` depend on `server` as a workspace package.
Rejected - `server` is a deployable Nest app, not a library; adding an export
surface to it purely so one script can reach one schema is more machinery
than the problem needs. If a second script needs the same reach-across later,
revisit.

### D4: Turbo pipeline

`turbo.json` defines `build`, `test`, `lint`, `format`, `format:check` tasks.
`build` has `"dependsOn": ["^build"]` (so `shared` builds before `server`,
which imports it); `test`/`lint` depend on `^build` too (they need `shared`'s
`dist/` and `.d.ts` present for type-aware oxlint and for `server`'s vitest
run, which imports `shared`'s built output the same way production code
does). `outputs` for `build` is `["dist/**"]` per package. No remote cache
config (`ui`, `remoteCache` left at Turbo's defaults / unset).

### D5: `.dependency-cruiser.cjs` after the move

The `domain-is-pure` rule is deleted (there's no `src/domain` left to check -
purity is now enforced by `shared` simply not depending on `server` in its
own `package.json`, which is structurally impossible to violate by accident).
The four remaining layer-direction rules (`infrastructure`/`application`/
`runtime`/`api`) drop `domain` from their `pathNot` layer lists and comments -
functionally this changes nothing (imports of the `shared` package never
match the `^src/...` patterns these rules scan), it just keeps the rule
comments accurate about what `^src` actually contains post-move.

## Risks / Trade-offs

- **Cross-package relative import (D3)** - `bin/generate-env.ts` reaching
  into `server/src/config/...` by relative path is a soft coupling no
  tool enforces. Mitigation: it's one file, one import; if `server/src/config`
  ever restructures, the break surfaces immediately as a script failure, not
  silent drift.
- **Six new `exports` subpaths (D2) is more `shared/package.json` boilerplate
  than a single barrel.** Mitigation: it's a one-time setup cost, and it
  matches the granularity the code already uses internally today.
- **`git mv` across two moves that touch overlapping files** (flatten
  `app/server` -> `server`, then `domain/` -> `shared/`) risks losing history
  if done as one big move instead of two sequential ones. Mitigation: the
  Migration Plan below does the flatten first, then extracts `domain/` from
  its new `server/` location - two clean `git mv` passes, never a combined
  move-and-rename in one command.
- **Deleting `terminal/` is irreversible in the working tree** (recoverable
  from git history, but not "still there to glance at"). Mitigation: the API
  parity comparison happened during exploration and is recorded in
  proposal.md's Why/Impact; tasks.md will include running `server`'s full
  test suite green before the deletion step, not after.

## Migration Plan

1. Add `turbo.json` and root devDependencies (`turbo`, `yargs`, `dotenv`,
   `mailparser`, `openai`, `zod`) - no file moves yet; `npm run build/test/lint`
   still work exactly as today, now also runnable via `turbo run`.
2. Flatten: `git mv app/server server`, `git mv app/front front`. Update the
   workspaces list, `docker-compose*.yml`, `server/Dockerfile`'s own
   self-reference (if any), `.github/workflows/ci.yml`, and
   `openspec/config.yaml`'s path mentions. Verify `npm test`/`npm run lint`
   still green from the new paths before moving on.
3. Extract: create `shared/package.json` + `vite.config.ts` +
   `tsconfig.json`; `git mv server/src/domain/<subfolder>` to
   `shared/src/<subfolder>` for each of the six subfolders. Update every
   `server/src` import that pointed at `../domain/...` to import from
   `shared/<subfolder>` instead. Update `.dependency-cruiser.cjs` per D5. Run
   `server`'s full test suite green.
4. Consolidate CLI scripts: `git mv server/bin/eval-prompt.ts bin/` and
   `git mv server/bin/generate-env.ts bin/`; update their imports (`shared`
   subpaths, plus the D3 relative reach for `generate-env.ts`); move
   `generate:env`, `generate:env-example`, `eval-prompt` npm scripts from
   `server/package.json` to root `package.json`, dropping the `nest build &&`
   prefix on `eval-prompt`. Run both scripts manually to confirm they work
   without a Nest build.
5. Delete `terminal/` (directory, and any leftover compose/CI/doc references -
   verified none remain in `docker-compose.yml` today).
6. Rewrite `CLAUDE.md` and `README.md` for the new layout.
7. Full verification: `turbo run build test lint format:check` green across
   `server`, `front`, `shared` from the repo root.

No rollback beyond standard git revert is needed - there's no deployed
runtime state this change touches (it's source layout only), and each step
above is independently verifiable before proceeding to the next.
