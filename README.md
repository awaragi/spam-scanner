# spam-scanner

An npm-workspaces monorepo for a Rspamd-backed, multi-mailbox IMAP spam
scanner.

## Layout

- **`server/`** — NestJS server: runs one scanner per mailbox (scan,
  train, whitelist/blacklist state via IMAP) and exposes an HTTP control API.
- **`front/`** — Angular control UI for the server API.
- **`shared/`** — framework-free domain logic (spam classification, scanning,
  sender lists, state, AI content, utils), built with Vite and imported by
  both `server` and the repo-root `bin/` CLI scripts.

Turbo (`turbo.json`) runs `build`/`test`/`lint`/`format:check` across all
three packages in dependency order; see `CLAUDE.md` for the full command
reference.

## Shared infrastructure

Rspamd and its supporting services are shared across apps and live at the
repo root: `docker-compose.yml` / `docker-compose.base.yml` and `rspamd/`.
Each app's own compose service builds from its own subfolder (e.g.
`server/`).

## Design process

`openspec/` is the process of record for design and planning work across the
whole monorepo.
