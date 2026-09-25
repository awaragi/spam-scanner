# Proposal

## Why

The project is about to grow a NestJS server (`app/server/`) and later a web
front end (`app/front/`) next to today's IMAP scanner. A flat single-package
layout can't hold several apps cleanly, so the repo needs to become a monorepo
first, before any server code lands. The current app keeps running unchanged
while that happens.

This is the first of a sequence of changes. After it come
`2-nest-server-foundation`, `3-mailbox-runners`, `4-mailbox-settings-email`,
`5-server-api-auth` and `6-per-user-bayes`.

## What Changes

- Move today's application (`src/`, `test/`, app-specific `bin/` scripts,
  `Dockerfile`, `.dockerignore`, `package.json`, `tsconfig.json`,
  `vitest*.config.js`, `eslint.config.js`, `README.md`, `ROADMAP.md`) into a
  root `terminal/` folder with `git mv`, so file history is preserved.
- Turn the root into an npm workspaces root (`"workspaces": ["terminal", "app/*"]`)
  with a single root `package-lock.json`. Shared tooling config (Prettier,
  `.github/`, `renovate.json`, `LICENSE`) stays at the root.
- Keep shared infrastructure at the root: `docker-compose.base.yml` (rspamd,
  redis, unbound), `rspamd/`, and the infra-only scripts in `bin/local/`
  (`docker-compose.yml`, `rspamd.sh`, `hash-rspamd-password.sh`).
  App-specific scripts (`start.sh`, `check-eml.sh`, `bin/docker/entrypoint.sh`)
  move with `terminal/`.
- Point the root `docker-compose.yml` `spam-scanner` service at
  `build: ./terminal`. A `server` service for `app/server/` is added later, by
  `2-nest-server-foundation`.
- Replace the root `README.md` and `CLAUDE.md` with a monorepo overview. The
  current detailed docs move to `terminal/README.md` and `terminal/CLAUDE.md`.
- Tidy up leftovers: delete `convert-to-typescript.tasks.md` (the conversion is
  complete), and decide where `skills/`, `docs/` and `.temp/` live (design).
- `openspec/` stays at the root as the single process of record for every
  package.
- `terminal/` is frozen from now on (bug fixes only) and gets deleted once the
  server reaches parity. That deletion is a separate, later change.

## Capabilities

### New Capabilities

_None._

### Modified Capabilities

_None expected._ Compose files and infra scripts stay at their current root
paths, so `compose-project-isolation` and `rspamd-external-storage` keep
holding as written. If the design moves `.env.example` or
`bin/local/docker-compose.yml`, add deltas for those two specs and drop
`skip_specs`.

## Impact

- **Paths:** every path under `src/` and `test/` moves to `terminal/src/` and
  `terminal/test/`. Path references in scripts (`bin/local/start.sh`,
  `package.json` scripts, the Dockerfile, the `.env.example` generator and its
  drift test, and the `prompt-engineer` skill's `.temp/reports/` path) need
  updating.
- **Docker:** the build context for the scanner image changes to `./terminal`.
  Compose project names, networks and the external data dir are unchanged.
- **Env files:** where `.env` / `.env.example` live (root, for Compose
  interpolation of `SPAM_SCANNER_DATA` / `RSPAMD_PASSWORD`, versus
  `terminal/`) is decided in the design. The assistant never reads real `.env`
  files; only `.env.example` is inspected.
- **Behavior:** none. The terminal app must run identically before and after
  (`npm test` green inside `terminal/`, and a smoke run via `start.sh`).
