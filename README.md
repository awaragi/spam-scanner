# spam-scanner

An npm-workspaces monorepo for a Rspamd-backed, multi-mailbox IMAP spam
scanner.

## Layout

- **`app/server/`** — NestJS server: runs one scanner per mailbox (scan,
  train, whitelist/blacklist state via IMAP) and exposes an HTTP control API.
- **`app/front/`** — Angular control UI for the server API.

## Shared infrastructure

Rspamd and its supporting services are shared across apps and live at the
repo root: `docker-compose.yml` / `docker-compose.base.yml` and `rspamd/`.
Each app's own compose service builds from its own subfolder (e.g.
`app/server/`).

## Design process

`openspec/` is the process of record for design and planning work across the
whole monorepo.
