# spam-scanner

An npm-workspaces monorepo for a Rspamd-backed spam-filtering system.

## Layout

- **`terminal/`** — the existing IMAP spam scanner: a single-mailbox CLI/service
  that scans, trains, and manages whitelist/blacklist state via IMAP. See
  [`terminal/README.md`](terminal/README.md) for setup, usage, environment
  variables, and architecture.
- **`app/server/`** — a NestJS multi-mailbox web server, forthcoming (not yet
  scaffolded).

## Shared infrastructure

Rspamd and its supporting services are shared across apps and live at the
repo root: `docker-compose.yml` / `docker-compose.base.yml` and `rspamd/`.
Each app's own compose service builds from its own subfolder (e.g.
`terminal/`).

## Design process

`openspec/` is the process of record for design and planning work across the
whole monorepo.
