# Design

## Context

See `proposal.md` for motivation and the file-level "What Changes" list. This
design resolves the two placement questions the proposal left open
(`.env`/`.env.example`, and `skills/`/`docs/`/`.temp/`) and lays out the exact
move sequence so it can be executed as ordered, mechanical tasks.

Current root layout relevant here: `.env`, `.env.example`, `.env.production`,
`.env.test` (root); `skills/prompt-engineer/` and `skills/review-branch/`
(root, each mirrored by a thin stub at `.claude/skills/<name>/SKILL.md` that
reads `skills/<name>/SKILL.md` "repo root" and follows it — see commit
`f8de490`); `docs/various/openspec/` (workflow diagrams, root); `.temp/`
(root, git-ignored, holds `eval-prompt.ts` sample datasets and reports).

## Goals / Non-Goals

**Goals:**
- Resolve `.env`/`.env.example` placement and `skills/`/`docs/`/`.temp/`
  placement definitively, so no task in `tasks.md` is left guessing.
- Produce a move sequence that keeps `terminal/` runnable (tests green, a
  smoke run works) at the end of the change, matching every path reference
  that breaks along the way.

**Non-Goals:**
- Creating `app/server/` (that's `2-nest-server-foundation`).
- Changing any app behavior, env var names, or test assertions beyond path
  updates forced by the move.
- Deciding the fate of the prompt-eval tooling beyond where its files live —
  whether it survives past `terminal/`'s eventual deletion is a later
  decision (see `2-nest-server-foundation`'s design, Non-Goals).

## Decisions

### D1. `.env` / `.env.example` stay at the repo root

The root `docker-compose.yml` (unchanged path) reads `env_file: .env` and
Compose interpolates `${SPAM_SCANNER_DATA}` / `${RSPAMD_PASSWORD}` from a
`.env` in the directory `docker compose` is invoked from — the repo root.
Moving the env files into `terminal/` would mean either a `--env-file` flag on
every Compose invocation or a symlink, for no benefit today, since `terminal/`
is still the only app Compose builds. `.env.production` and `.env.test` move
with it (they're read the same way, by path, not by convention tied to
`src/`). `.gitignore`'s existing `.env` / `.env.*` / `!.env.example` patterns
already match the root and need no change.

**Consequence — two path references move with the generator, not the file:**
- `terminal/package.json`'s `generate:env-example` script currently runs
  `node src/cli/generate-env.ts --output .env.example` with cwd = the
  package directory (npm workspaces run scripts with cwd set to the member
  package). It must become `--output ../.env.example` so it still writes to
  the real root file.
- `test/unit/core/config.test.ts`'s drift test resolves `repoRoot` as
  `dirname(thisFile)/../../..` (three levels up from
  `test/unit/core/config.test.ts` to the old root). Once this file lives at
  `terminal/test/unit/core/config.test.ts`, the real root is one level
  further up: the resolution becomes `../../../..`.

Alternative considered: move `.env*` into `terminal/` and point Compose's
`env_file` at `./terminal/.env`. Rejected — it centralizes nothing (Compose
config would still need a `terminal`-aware path) and adds a rename for no
gain until `app/server/` needs its own separate env file, which
`2-nest-server-foundation` already gives it.

### D2. `skills/`, `docs/`, `.temp/` split by whether they're terminal-specific

- **`skills/prompt-engineer/`** reads `.temp/reports/` and edits
  `src/cli/eval-prompt.ts` output / `src/lib/clients/ai.client.ts` — entirely
  terminal-specific. It moves to `terminal/skills/prompt-engineer/`.
- **`.temp/`** is used only by `eval-prompt.ts` and that skill. It is
  git-ignored (`git ls-files .temp` is empty), so this is a plain filesystem
  move, not a `git mv`. It moves to `terminal/.temp/`.
- **`skills/review-branch/`** is a generic git workflow, unrelated to this
  project's code. It stays at the root.
- **`docs/various/openspec/`** documents the OpenSpec process itself
  (diagrams), not terminal's code. It stays at the root.
- **The `.claude/skills/prompt-engineer/SKILL.md` stub** must be updated: it
  currently says "Read `skills/prompt-engineer/SKILL.md` (repo root)" — this
  becomes "Read `terminal/skills/prompt-engineer/SKILL.md`". The
  `.claude/skills/review-branch/SKILL.md` stub is untouched.

Alternative considered: move all of `skills/` and `docs/` into `terminal/`
uniformly for simplicity. Rejected — `review-branch` and the OpenSpec diagrams
apply to the whole monorepo (and to `app/server/` once it exists), so bundling
them into `terminal/` would misplace them the moment change 2 lands.

### D3. `.nvmrc` stays at the root

Not mentioned explicitly in the proposal. It declares the Node version for
the whole toolchain; `app/server/` targets the same Node 24 (per
`2-nest-server-foundation`'s design), so one root `.nvmrc` correctly serves
every workspace member. It is not duplicated into `terminal/`.

### D4. Move sequence

Ordered so `terminal/` is never left broken partway through, and so `git mv`
runs before any path-reference edit (an edit made through a moved-away path
would fail):

1. `git mv` the app itself: `src/`, `test/`, `bin/local/start.sh`,
   `bin/local/check-eml.sh`, `bin/docker/entrypoint.sh`, `Dockerfile`,
   `.dockerignore`, `package.json`, `package-lock.json` (converted to the
   workspace lockfile in step 6 — see below), `tsconfig.json`,
   `vitest.config.js`, `vitest.integration.config.js`, `eslint.config.js`,
   `README.md`, `ROADMAP.md` → `terminal/`.
2. Plain-move (not `git mv`, git-ignored) `.temp/` → `terminal/.temp/`.
3. `git mv skills/prompt-engineer` → `terminal/skills/prompt-engineer`.
   `skills/review-branch` stays; `docs/` stays.
4. Fix path references broken by the move (each is a single, mechanical
   edit):
   - `.claude/skills/prompt-engineer/SKILL.md` — updated path (D2).
   - `terminal/package.json`'s `generate:env-example` script — `../.env.example` (D1).
   - `terminal/test/unit/core/config.test.ts`'s `repoRoot` resolution —
     add one more `..` (D1).
   - `terminal/bin/local/start.sh` — check for any path assumption relative
     to the old root and adjust if present.
   - `terminal/bin/docker/entrypoint.sh` — same check.
   - Root `docker-compose.yml`'s `spam-scanner` service — `build: .` becomes
     `build: ./terminal`.
5. Write the new root `package.json`: `"private": true`,
   `"workspaces": ["terminal", "app/*"]`, no `dependencies` of its own.
   `terminal/package.json` keeps its existing `dependencies`/`devDependencies`
   and scripts (with the one path fix from step 4).
6. Regenerate the lockfile at the root: `npm install` from the repo root
   with the new workspaces manifest in place, producing a single root
   `package-lock.json`. Delete the old `terminal/package-lock.json` if `npm
   install` doesn't already remove it.
7. Write the new root `README.md` and `CLAUDE.md` (short monorepo overview:
   what `terminal/` and `app/server/` are, where shared infra lives, a
   pointer to `terminal/README.md` for the scanner's own documentation).
   `git mv` the current root `README.md`/`CLAUDE.md` content into
   `terminal/README.md` / `terminal/CLAUDE.md` first (already covered by
   step 1 for `README.md`; `CLAUDE.md` needs its own `git mv` since the
   proposal's step-1 file list didn't name it explicitly — add it there).
8. Delete `convert-to-typescript.tasks.md` (conversion complete, per
   proposal).
9. Verify: `npm test` (from root, running the `terminal` workspace) is green,
   and `terminal/bin/local/start.sh` (or the project's existing smoke-test
   approach) runs an unchanged scan cycle successfully.
10. Commit.

## Risks / Trade-offs

- **[Risk] A path reference is missed** (a script, a doc, a relative import)
  and only surfaces at runtime. → Mitigation: step 9's verification gate
  (`npm test` green + a real smoke run) before this change is considered
  done; `grep -rn` for the old root-relative paths (`src/`, `./src`,
  `'../../../..'`-style test resolutions) across the repo before committing,
  to catch anything the sequence above didn't anticipate.
- **[Risk] `npm install` at the root reshapes `package-lock.json` more than
  expected** (dependency resolution can shift slightly under workspaces).
  → Mitigation: diff the new lockfile's dependency versions against the old
  one; re-run `npm test` after regenerating it, not just after the file
  moves.
- **[Trade-off] Two `.claude/skills/*` stubs now point at different
  locations** (`review-branch` at repo root, `prompt-engineer` inside
  `terminal/`). This is intentional (D2) but easy to forget when adding a
  future terminal-specific skill — worth a one-line note in the new root
  `CLAUDE.md`.

## Migration Plan

This is the deploy: the sequence in D4 **is** the migration, run once,
directly on the `server` branch, committed as a single change (or a small
number of directly-related commits — no intermediate broken state is
pushed). Rollback is `git revert` of that commit (or resetting the branch,
since nothing has been merged to `master` yet).
