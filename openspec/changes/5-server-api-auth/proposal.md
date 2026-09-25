# Proposal

## Why

The point of the server is to control scanning over HTTP: trigger a run on
demand, see each mailbox's status, and manage its settings, state and sender
lists. Today these are standalone CLI and admin scripts that need shell access
and a local `.env`. The API also needs access control from day one. It starts
simple and can become more advanced later.

Depends on `3-mailbox-runners` and `4-mailbox-settings-email`.

## What Changes

- **Admin login.** `POST` a password, check it against a password in env, and
  get back a short-lived **admin token**.
- **Mailbox token exchange.** An admin token can be exchanged for a
  **mailbox token** scoped to a single mailbox id.
- **Admin scope (app level):** list mailboxes and their runner status, read
  app health and AI failure status, and read app settings. Editing app
  settings stays env-only for now.
- **Mailbox scope (one mailbox):**
  - trigger any job on demand (`scan`, the training jobs, `init-folders`),
    coalescing with timers per `server/mailbox-runtime`;
  - read and update that mailbox's settings (update-by-restart per
    `server/mailbox-settings`);
  - read and reset scanner state;
  - read, replace, import and export the whitelist and blacklist;
  - read that mailbox's status and recent job results.
- **Guards.** An admin guard and a mailbox-scope guard, where the token's
  mailbox id must match the route's. A mailbox token never grants app-level
  access. An admin token uses mailbox routes by exchanging for a mailbox token
  first.
- **Validation.** Request input is validated with zod through Nest 12's
  Standard Schema support.
- **Health.** A health endpoint reports whether the server is up, whether
  rspamd is reachable, the global AI failure status, and a per-mailbox summary
  (running or degraded, IDLE or loop, age of the last successful scan).
- **Retiring the scripts.** Terminal's admin scripts (export and import of
  lists and mailbox state, read, write, reset and delete state) get API
  equivalents. The scripts themselves go away with `terminal/`.

## Capabilities

### New Capabilities

- `server/api-auth`: password to admin token, exchange for a mailbox token,
  token scopes and expiry, and guard behavior.
- `server/mailbox-api`: the mailbox-scoped endpoints (job triggers, settings,
  state, lists, status) and the admin endpoints (mailbox list, health).

### Modified Capabilities

_None._ `sender-lists`' CLI-script requirements keep describing `terminal/`.
The server's API equivalents are specified under `server/mailbox-api`.

## Impact

- **New dependencies:** likely `@nestjs/jwt`. The token signing secret and the
  admin password are new global env keys.
- **Security:** job triggers and settings updates are privileged. Requests
  without a token are rejected everywhere except login and a minimal
  liveness probe.
- **Testing:** API tests (`test/api`, possibly against a local IMAP server
  such as GreenMail or a Dovecot container) are acknowledged and deferred to a
  later discussion. This change relies on unit tests.
