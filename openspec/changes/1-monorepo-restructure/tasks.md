# Tasks

## 1. Move terminal application into terminal/

- [x] 1.1 `git mv` the app into `terminal/`: `src/`, `test/`, `bin/local/start.sh`, `bin/local/check-eml.sh`, `bin/docker/entrypoint.sh`, `Dockerfile`, `.dockerignore`, `package.json`, `tsconfig.json`, `vitest.config.js`, `vitest.integration.config.js`, `eslint.config.js`, `README.md`, `ROADMAP.md`, `CLAUDE.md` — verify: `git status --short` shows renames (`R`), not delete+add pairs, and `ls terminal/src terminal/test` succeed
- [x] 1.2 Plain-move (not `git mv` — git-ignored) `.temp/` → `terminal/.temp/` — verify: `terminal/.temp/reports` and `terminal/.temp/messages` are non-empty, and `.temp` no longer exists at the repo root
- [x] 1.3 `git mv skills/prompt-engineer` → `terminal/skills/prompt-engineer` — verify: `terminal/skills/prompt-engineer/SKILL.md` exists; `skills/review-branch/` and `docs/` are untouched at the root (design D2)

## 2. Fix path references broken by the move

- [x] 2.1 Update `.claude/skills/prompt-engineer/SKILL.md`'s pointer from `skills/prompt-engineer/SKILL.md` (repo root) to `terminal/skills/prompt-engineer/SKILL.md` — verify: `grep -n "prompt-engineer/SKILL.md" .claude/skills/prompt-engineer/SKILL.md` shows the new path
- [x] 2.2 Fix `terminal/package.json`'s `generate:env-example` script to `node src/cli/generate-env.ts --output ../.env.example` (design D1) — verify: running `npm run generate:env-example --workspace=terminal` from the root writes to the real root `.env.example`, not `terminal/.env.example`
- [x] 2.3 Fix `terminal/test/unit/core/config.test.ts`'s `repoRoot` resolution to add one more `..` (three `..` → four, since the test file is now one level deeper) — verify: `configGroups -> .env.example sync` test passes
- [x] 2.4 Read through `terminal/bin/local/start.sh` and `terminal/bin/docker/entrypoint.sh` for any path assumption relative to the old repo root, and fix any found — verify: no remaining reference resolves to a path outside `terminal/` incorrectly; scripts still parse (`bash -n <script>`)
- [x] 2.5 Update the root `docker-compose.yml`'s `spam-scanner` service `build:` from `.` to `./terminal` — verify: `docker compose -f docker-compose.yml -f docker-compose.base.yml config` resolves without error and shows `build.context: terminal`

## 3. Set up npm workspaces at the root

- [x] 3.1 Write a new root `package.json`: `"private": true`, `"workspaces": ["terminal", "app/*"]`, no dependencies of its own — verify: file is valid JSON and `npm install` from the root does not error on the manifest itself
- [x] 3.2 Run `npm install` from the root to regenerate a single root `package-lock.json`; delete `terminal/package-lock.json` if it remains — verify: exactly one `package-lock.json` exists (at the root), `terminal/package-lock.json` is absent, and `npm ls --workspace=terminal` resolves cleanly

## 4. Root docs and cleanup

- [x] 4.1 Write a new root `README.md`: a short monorepo overview (what `terminal/` and `app/server/` are, where shared infra lives) with a pointer to `terminal/README.md` for the scanner's own documentation — verify: file exists and the pointer link/path is correct
- [x] 4.2 Write a new root `CLAUDE.md`: monorepo overview plus a one-line note on where each skill's content lives (`review-branch` at the root, `prompt-engineer` inside `terminal/`, per design D2) — verify: file exists
- [x] 4.3 Delete `convert-to-typescript.tasks.md` (conversion complete) — verify: `git status` shows it removed and it is absent from the working tree

## 5. Verify terminal still works end to end

- [x] 5.1 Run `npm test` from the root (exercising the `terminal` workspace) and confirm every test passes, including the fixed `config.test.ts` drift test — verify: green test run, zero failures. **Done:** 501/501 tests passed; the drift test passes in isolation too.
- [ ] 5.2 Run a real smoke cycle via `terminal/bin/local/start.sh` against a dev/test mailbox and confirm it connects and completes a scan cycle without error — verify: observed log output shows a completed cycle, no path-related errors. **Deferred:** this touches a real mailbox and real rspamd (moves mail, trains Bayes) — not run without the user's direct say-so. Left unchecked; run manually when desired.
- [x] 5.3 Grep the repo for any remaining root-relative path assumption the moves above didn't anticipate (old `src/`, `./src`, bare `test/` references outside `terminal/`, other relative-path counts in copied files) and fix anything found — verify: no unexpected matches remain outside `terminal/`'s own paths. **Done:** no stray path references found. Found and fixed two related gaps outside the original grep scope: the new root `package.json` had no `test`/`lint`/`format:check` scripts, breaking CI (added workspace-delegating scripts); `.github/workflows/ci.yml`'s `docker-build` job built from `context: .`, which no longer has a `Dockerfile` (pointed it at `./terminal`). A third gap — `terminal/Dockerfile`'s `npm ci` needs a lockfile that now lives only at the monorepo root, so the image build itself still fails — is a known, accepted limitation per the user's call not to invest further in terminal's Docker setup.
