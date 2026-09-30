# Proposal

## Why

An operator currently has no way to take a single problematic mailbox out of
rotation (bad IMAP credentials, an account being decommissioned, load
shedding) without editing that mailbox's env vars and restarting the whole
server, which stops every other mailbox's runner too. A per-mailbox
enable/disable switch, controllable both from an env default and at runtime
via the API, lets an operator (or the mailbox owner, for their own mailbox)
pause and resume a single runner without touching the rest of the fleet.

## What Changes

- New env var `MAILBOX_<n>_ENABLED` (boolean, default `true`) added to each
  mailbox's connection config.
- At bootstrap, the server SHALL NOT start a runner for a mailbox whose
  resolved enabled state is `false`.
- New admin-scoped endpoint to enable/disable any mailbox's runner.
- New mailbox-scoped endpoint for the mailbox owner to enable/disable only
  their own mailbox's runner (reusing the existing `MailboxScopeGuard`, which
  already rejects a mismatched mailbox id).
- A runtime enable/disable call changes only in-memory state for the current
  process; it is **not** persisted to the mailbox's IMAP state folder. A
  process restart always re-resolves the enabled state from
  `MAILBOX_<n>_ENABLED`, discarding any runtime toggle made via the API.
- Disabling a running mailbox SHALL stop it gracefully: any job already in
  progress is allowed to finish, no new job is started, and no new IMAP
  connection is opened — the same shutdown semantics `MailboxRunner` already
  uses when the whole process stops.
- Enabling a disabled mailbox SHALL construct and start a fresh runner for
  it, following the same bootstrap path used at process startup.
- Existing mailbox listing/status/health endpoints are extended to report
  each mailbox's current enabled/disabled state.
- Frontend: an enable/disable button is added to the admin mailbox list (any
  mailbox) and to the mailbox detail page (the signed-in mailbox owner's own
  mailbox), for manual testing of the new endpoints.

## Capabilities

### New Capabilities

None — this change extends behavior already owned by three existing
capabilities rather than introducing a new one.

### Modified Capabilities

- `server/configuration`: the mailbox-connection-info key set gains an
  `enabled` flag (default `true`), read once at startup like the rest of a
  mailbox's connection config.
- `server/mailbox-runtime`: bootstrap SHALL only start a runner for an
  enabled mailbox; the server gains the ability to stop a running mailbox's
  runner (graceful, no forced job abort) and to (re)start a stopped one on
  demand; the existing "make available" status requirement gains the
  mailbox's current enabled/disabled state.
- `server/mailbox-api`: new admin-scoped and mailbox-scoped endpoints to
  enable/disable a mailbox's runner; existing mailbox-listing and health
  endpoints report each mailbox's enabled/disabled state alongside its
  existing running/degraded status.

## Impact

- `server/src/config/app-config.schema.ts` — `RawMailboxSlot`,
  `MailboxConnectionConfig`, `MailboxesSchema` transform, `mailboxDocGroup`
  (for `.env.example` generation).
- `server/src/infrastructure/mailboxes/mailbox.ts`,
  `mailbox.repository.ts` — thread the resolved `enabled` flag onto
  `Mailbox`.
- `server/src/runtime/runner-registry.ts` — bootstrap gating, new
  enable/disable methods (distinct from `withRunnerPaused`, which always
  restarts), in-memory enabled/disabled tracking, status reporting.
- `server/src/runtime/mailbox-runner.ts` — no behavioral change expected
  beyond what `stop()`/`start()` already provide; confirm during design.
- `server/src/api/admin/admin.controller.ts` — admin-scoped enable/disable
  endpoint; extend mailbox listing/health responses.
- `server/src/api/mailbox/mailbox.controller.ts` — mailbox-scoped
  enable/disable endpoint.
- repo-root `.env.example` — regenerated via `npm run generate:env-example`.
- `front/src/app/pages/admin/admin.component.ts`,
  `front/src/app/pages/mailbox/mailbox.component.ts`,
  `front/src/app/core/api.service.ts` — enable/disable button and API call.
