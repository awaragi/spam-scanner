# Tasks

## 1. Turbo and root tooling

- [x] 1.1 Add `turbo` as a root devDependency and create `turbo.json` defining `build` (`dependsOn: ["^build"]`, `outputs: ["dist/**"]`), `test` (`dependsOn: ["^build"]`), `lint` (`dependsOn: ["^build"]`), `format`, `format:check` tasks; verify `npx turbo run build` runs (even as a no-op) against the still-current `app/*` workspaces
- [x] 1.2 Add `.turbo` to `.gitignore`; verify `git status` shows no `.turbo` cache artifacts after running `turbo run build`

## 2. Flatten app/* to repo root

- [x] 2.1 `git mv app/server server` and `git mv app/front front`; verify `git status` shows renames (not delete+add) via `git log --follow server/package.json` showing pre-move history
- [x] 2.2 Update root `package.json`'s `workspaces` to `["server", "front", "shared"]` (explicit list, `shared` added now even though its directory doesn't exist yet) and its `test`/`front:start` scripts' `--workspace=` paths; verify `npm ls --workspaces --depth=0` lists `server` and `front` at their new paths without error
- [x] 2.3 Update `docker-compose.yml`'s `server` service `dockerfile:` path (`app/server/Dockerfile` -> `server/Dockerfile`); verify `docker compose config` renders without error
- [x] 2.4 Rewrite `server/Dockerfile`'s paths from `app/server/...` to `server/...` (both stages, `COPY`, `WORKDIR`-relative paths, `ENTRYPOINT`) and its build-context comment; verify `docker build -f server/Dockerfile .` still builds (deferred to task 4.4 once `shared` exists, since the build now needs it - do not build a working image yet if `shared` isn't wired in)
- [x] 2.5 Update `.github/workflows/ci.yml`'s `docker-build` job `file:` path to `server/Dockerfile`; verify the workflow YAML is syntactically valid (`yamllint .github/workflows/ci.yml` or equivalent)
- [x] 2.6 Update `openspec/config.yaml`'s context paragraph's `app/server`/`app/front` mentions to `server`/`front`; verify `openspec validate --change flatten-monorepo-shared-domain` still passes
- [x] 2.7 Run `npm test` and `npm run lint` from the repo root (still targeting the old script names/paths as needed) and confirm both are green at the new `server`/`front` paths before proceeding

## 3. Extract domain/ into the shared package

- [x] 3.1 Create `shared/package.json` (`"name": "shared"`, `"private": true`, `"type": "module"`) with `vite`, `vite-plugin-dts`, `typescript`, `vitest` as its own devDependencies, and an `exports` map with one subpath per subfolder (`./ai`, `./classification`, `./scanning`, `./sender-lists`, `./state`, `./utils`) pointing at `./dist/<folder>/index.js` + `./dist/<folder>/index.d.ts`; verify `npm install` resolves cleanly from the root
- [x] 3.2 Create `shared/vite.config.ts` (library mode, one entry per subfolder per design.md D2) and `shared/tsconfig.json`; verify `npm run build --workspace=shared` produces `shared/dist/<folder>/index.js` and `.d.ts` for a placeholder entry file
- [x] 3.3 For each of `ai/`, `classification/`, `scanning/`, `sender-lists/`, `state/`, `utils/`: `git mv server/src/domain/<folder>` to `shared/src/<folder>` (including its `.spec.ts` files) and add a barrel `shared/src/<folder>/index.ts` re-exporting that folder's public functions/types; verify `git log --follow` on one moved file (e.g. `shared/src/utils/concurrency.ts`) shows history predating the move
- [x] 3.4 Update every `server/src` import that referenced `../domain/...` (in `application/`, `infrastructure/`) to import from the matching `shared/<folder>` subpath instead; verify `npm run build --workspace=server` succeeds with zero remaining references to `src/domain` (`grep -rL` check)
- [x] 3.5 Update `server/.dependency-cruiser.cjs` per design.md D5: delete the `domain-is-pure` rule, drop `domain` from the four remaining rules' `pathNot` lists and comments; verify `npm run lint:deps --workspace=server` passes
- [x] 3.6 Run `npm test --workspace=server` and `npm test --workspace=shared` (once `shared`'s own vitest config exists, mirroring the moved `.spec.ts` files) and confirm both green

## 4. Consolidate CLI scripts into root bin/

- [x] 4.1 Add `yargs`, `dotenv`, `mailparser`, `openai`, `zod` as explicit root `package.json` devDependencies; verify `npm ls yargs dotenv mailparser openai zod` resolves them at the root
- [x] 4.2 `git mv server/bin/eval-prompt.ts bin/eval-prompt.ts` and `git mv server/bin/generate-env.ts bin/generate-env.ts`; verify `git log --follow` on both shows pre-move history
- [x] 4.3 Update `bin/eval-prompt.ts`'s imports to the `shared` subpath exports (dropping the `../dist/domain/...` reach) and `bin/generate-env.ts`'s imports to `shared/utils` plus the relative reach into `../server/src/config/app-config.schema.ts` (design.md D3); verify both run standalone: `node bin/generate-env.ts --output /tmp/check.env` and `node bin/eval-prompt.ts --help` exit 0 with no build step run first
- [x] 4.4 Move `generate:env`, `generate:env-example`, `eval-prompt` npm scripts from `server/package.json` to root `package.json`, updating their paths and dropping the `nest build &&` prefix on `eval-prompt`; verify `npm run generate:env-example` from the root regenerates `.env.example` with no diff against the committed file
- [x] 4.5 Now that `shared` exists and root `bin/` scripts no longer need `server`'s `dist/`, finish `server/Dockerfile`'s build stage (task 2.4) to also `COPY shared/package.json`/`shared/src` and run `npm run build --workspace=shared` before `npm run build --workspace=server`; verify `docker build -f server/Dockerfile .` succeeds end to end

## 5. Delete terminal/

- [x] 5.1 Confirm (re-run the route/script comparison from design.md's Context) that no remaining `terminal/src/cli/*` or `terminal/src/admin/*` script lacks a `server` API or bootstrap equivalent, other than the already-agreed-dropped `read-email.ts`/`uid-on-date.ts`; verify by listing `terminal/src/cli` and `terminal/src/admin` against the mapping in proposal.md's What Changes
- [x] 5.2 Run `server`'s full test suite (`npm test --workspace=server`) green as a pre-deletion checkpoint (per design.md's Risks mitigation - test before, not after, deleting)
- [x] 5.3 `git rm -r terminal/`; verify `git status` shows the directory removed and `npm install` at the root still succeeds (no dangling workspace reference)
- [x] 5.4 Search the repo for any remaining `terminal` references (`grep -rl terminal --include=*.yml --include=*.json --include=*.md .`, excluding `openspec/changes/archive/`) and remove any found; verify the grep returns nothing outside archived openspec changes

## 6. Documentation cleanup

- [x] 6.1 Rewrite CLAUDE.md's Layout section for the new root-level `server/`, `front/`, `shared/`, `bin/` layout (no more `app/*`, no more `terminal/`); verify by re-reading the file for any leftover `app/` or `terminal/` mention
- [x] 6.2 Rewrite CLAUDE.md's Server architecture section: `domain/` is no longer `server/src/`'s innermost layer - describe it as the `shared` package `server` depends on, with the layer list starting at `config/`; verify the layer list matches `.dependency-cruiser.cjs`'s actual rules after task 3.5
- [x] 6.3 Update CLAUDE.md's Commands section for root-level `bin/` script paths and mention Turbo as the task runner (`turbo run build/test/lint`) alongside the existing per-workspace `npm` commands; verify each documented command actually runs as written
- [x] 6.4 Update README.md for the new layout (drop `app/*`/`terminal/` references); verify by re-reading for leftover mentions
- [x] 6.5 Update `server/skills/prompt-engineer/SKILL.md` and its `.claude/skills/prompt-engineer/` stub for the new `server/` path (was `app/server/`); verify the skill's documented paths resolve

## 7. Final integration verification

- [x] 7.1 Run `turbo run build test lint format:check` from the repo root and confirm every task across `server`, `front`, `shared` succeeds
- [x] 7.2 Run `npm run eval-prompt -- --help` and `npm run generate:env-example` from the root (now root-level scripts per task 4.4) and confirm both work with no Nest build in their path
- [x] 7.3 Start the server via `bin/local/server-dev.sh` (updated for the new root `bin/`/`server/` layout if it referenced old paths) and confirm it boots against a mailbox, exercising `shared`'s built output in the real runtime path, not just tests
