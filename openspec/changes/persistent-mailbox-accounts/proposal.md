# Proposal

## Why

Mailbox connection info and durable enable/disable state live in numbered
`MAILBOX_<n>_*` environment variables, so adding, editing, or removing an
account requires editing `.env` and restarting the server. Operators want to
manage the full account lifecycle from the Angular admin UI—with changes
that survive restart and take effect without a process reload.

## What Changes

- **BREAKING:** Mailbox connection keys (`MAILBOX_*`) are removed from the
  server's validated environment schema. The server MAY start with zero
  configured mailboxes.
- **`SPAM_SCANNER_DATA`** becomes a real app setting (not compose-docs-only).
  Account records are stored in a fixed filename under that directory
  (`accounts.json`).
- A replaceable **account store** (JSON file implementation first) holds
  connection fields, plain-text IMAP passwords, `enabled`, and admin-only
  `aiEnabled`, with a monotonic file **version** for optimistic locking.
- **Admin CRUD** at `/admin/accounts` (separate from `/admin/settings`).
  **`GET /admin/settings`** returns app settings only—no mailbox list.
- All account mutations (including enable/disable and `aiEnabled`-only
  updates) require a successful **IMAP connection test** before persistence,
  then update the live runner registry (add/update/remove/start/stop).
- Optimistic concurrency via **`If-Match`** / **`ETag`** on mutating
  requests (428 when missing, 409 when stale).
- **`aiEnabled`** moves from IMAP settings overrides to the account store;
  only admins set it on create/update. Mailbox-scoped settings updates MUST
  NOT accept `aiEnabled`.
- Docker Compose: bind-mount **`SPAM_SCANNER_DATA`** into the server
  container so the accounts file is persistent on the host.
- Angular admin: account list/create/edit/delete and persistent enable
  toggles (admin and mailbox owner).

## Capabilities

### New Capabilities

- `server/mailbox-accounts`: durable account registry file, account-store
  abstraction, optimistic locking, IMAP pre-save validation, and mapping
  stored records to managed mailboxes.

### Modified Capabilities

- `server/configuration`: `SPAM_SCANNER_DATA` validated and used by the
  server; mailbox connection env keys removed; zero mailboxes allowed at
  startup.
- `server/mailbox-registry`: registry backed by the account store instead
  of environment configuration; membership can change at runtime.
- `server/mailbox-api`: `/admin/accounts` CRUD; `/admin/settings` without
  mailboxes; persistent enable/disable (admin and owner) with precondition
  headers; duplicate account id rejected before IMAP test.
- `server/mailbox-settings`: per-mailbox AI enablement is account-store
  admin data, not an IMAP override; legacy `aiEnabled` in settings messages
  ignored.
- `server/mailbox-runtime`: bootstrap from account store; registry supports
  add/remove/update accounts and persisted enabled state without restart.
- `rspamd-external-storage`: `SPAM_SCANNER_DATA` is also used by the server
  for account storage (not compose-only).

## Impact

- `server/src/config/` — schema groups, remove dynamic `MAILBOXES` env parse;
  add `SPAM_SCANNER_DATA` to `AppConfigSchema`.
- `server/src/infrastructure/accounts/` — `AccountStore` port, JSON adapter,
  IMAP connection test helper.
- `server/src/infrastructure/mailboxes/` — `MailboxRepository` reads store.
- `server/src/application/accounts/` — orchestration (lock, test, persist,
  registry).
- `server/src/runtime/runner-registry.ts` — dynamic membership, reload
  mailbox snapshot on account update.
- `server/src/api/admin/` — `accounts.controller.ts`; trim `admin.controller`
  settings response.
- `server/src/api/mailbox/` — persistent enable via shared service;
  settings schema drops `aiEnabled`.
- `docker-compose.yml` — server volume for `SPAM_SCANNER_DATA`.
- `front/` — admin account CRUD UI; persistent enable copy.
- Repo-root `.env.example` — regenerated; mailbox env template removed.
- No automated migration from `MAILBOX_*` (operators create `accounts.json`
  manually).
