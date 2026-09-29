# Design

## Context

See `proposal.md` - Why/What Changes for motivation and scope.

Today, `RunnerRegistry.onApplicationBootstrap()` builds `runners: Map<string, MailboxRunner>`
by constructing and starting exactly one `MailboxRunner` per mailbox returned
by `mailboxRepository.findAll()`, unconditionally. Every other registry
method (`getStatus`, `triggerNow`, `updateSettings`, `withRunnerPaused`, ...)
looks a mailbox id up in that same map and throws a plain
`Error('Unknown mailbox: ...')` when absent, which the controllers translate
to a 404. There is currently no way to represent "a mailbox the server knows
about but has no runner for" - absence from the map always means "not a
managed mailbox at all."

`MailboxRunner.stop()` already implements the graceful-stop semantics this
change needs at runtime (clears the interval timer, aborts the IDLE loop,
awaits in-flight job runs, never forces a run to abort). `restartRunner()`
already implements the fresh-start semantics (construct a new `MailboxRunner`,
fire-and-forget `.start()`, `runners.set(id, runner)`). Both are reused as-is;
nothing about `MailboxRunner` itself needs to change.

## Goals / Non-Goals

**Goals:**
- Gate runner startup at bootstrap on each mailbox's resolved `enabled` config.
- Let an admin (any mailbox) or a mailbox owner (only their own) flip a
  mailbox's runner on/off at runtime, in-memory only.
- Make a disabled mailbox distinguishable, in the registry and in the API,
  from both "unknown mailbox" (404) and "enabled but degraded."

**Non-Goals:**
- Persisting the runtime toggle to the mailbox's IMAP state folder, or to
  any other durable store (explicit product decision: env var is the only
  durable source of truth).
- Changing `.env` migration tooling (`bin/generate-env.ts`'s migrate mode) -
  a new key with a default of `true` needs no migration handling.
- Any new auth concept - the admin/owner split is already fully provided by
  the existing `AdminGuard` and `MailboxScopeGuard`.

## Decisions

**Track disabled mailboxes as "known, no runner" rather than a parallel flag.**
`RunnerRegistry` gains a second map, `mailboxes: Map<string, Mailbox>`,
populated from `mailboxRepository.findAll()` once at bootstrap (the full,
static list of configured mailboxes never changes at runtime - only whether
each currently has a runner does). A lookup that needs "does this mailbox
exist at all" checks `mailboxes`; a lookup that needs "is it currently
running" checks `runners`. A mailbox present in `mailboxes` but absent from
`runners` is disabled. This avoids adding a boolean flag that could drift
from the map's actual contents, and keeps "unknown mailbox" (absent from
`mailboxes`, still a 404) cleanly distinct from "disabled" (present in
`mailboxes`, absent from `runners`).
Alternative considered: a `Map<string, {mailbox, runner?, enabled}>` wrapper
- rejected as redundant state, since "has a runner" and "is enabled" would
always need to be kept in sync manually instead of being definitionally the
same fact.

**Bootstrap skips constructing a runner for a disabled mailbox entirely**
(does not construct-then-not-start it). Matches "no runner" being the
definition of disabled, and avoids a `MailboxRunner` instance existing that
was never asked to `start()`.

**New `RunnerRegistry` methods `disableMailbox(id)` / `enableMailbox(id)`,
not a reuse of `withRunnerPaused`.** `withRunnerPaused` always restarts in
its `finally`, which is exactly wrong for disable (must stay stopped) and
irrelevant for enable (there is no existing runner to pause). Both new
methods:
- throw the existing plain `Error('Unknown mailbox: ...')` for an id absent
  from `mailboxes`, translated to 404 by the controller exactly like every
  other method;
- are idempotent: disabling an already-disabled mailbox, or enabling an
  already-enabled one, is a no-op that succeeds rather than erroring -
  matches a toggle-button UI where a stale client view could send either
  call regardless of current state.

`disableMailbox`: `await runners.get(id)?.stop()`, then `runners.delete(id)`.
`enableMailbox`: if `runners.has(id)`, return; else build a fresh
`MailboxRunner` from `mailboxes.get(id)` and fire-and-forget `.start()`,
`runners.set(id, runner)` - i.e. inline the same two lines `restartRunner`
already does, rather than generalizing `restartRunner` itself (it also
serves `updateSettings`/`withRunnerPaused`, which always have an existing
runner to replace; enable may not).

**One API shape, admin and owner both use it.** `PUT` with body
`{ enabled: boolean }`, mirroring the existing settings-update endpoint's
shape (`PUT .../settings`), on two routes backed by the same
`RunnerRegistry` methods:
- `PUT /admin/mailboxes/:mailboxId/enabled` under `AdminController`
  (`@UseGuards(AdminGuard)`) - no mailbox-id restriction, per the admin-can-
  target-any-mailbox requirement.
- `PUT /mailboxes/:mailboxId/enabled` under `MailboxController`
  (`@UseGuards(MailboxScopeGuard)`) - the guard's existing
  `payload.mailboxId === request.params.mailboxId` check already enforces
  "own mailbox only," with no new authorization logic needed.
A single boolean body (versus separate `/enable` and `/disable` POST routes)
was chosen to match the existing settings-update precedent and to give the
frontend one call for a toggle rather than two conditional ones.

**Status reporting:** the mailbox-listing and health endpoints add an
`enabled` field per mailbox; when `enabled` is `false`, the degraded/IDLE-
polling/per-job fields are omitted rather than defaulted to some placeholder
value, consistent with the spec delta's "only its enabled state is
meaningful" wording.

**Frontend:** the admin mailbox list gets a toggle button per row (calls the
admin-scoped endpoint); the mailbox detail page gets one toggle button for
the signed-in mailbox's own status (calls the mailbox-scoped endpoint).
`ApiService` needs one new method for an authenticated admin `PUT` (today it
only has `adminGet`); the existing `mailboxPut` already covers the owner
route.

## Risks / Trade-offs

- **In-memory-only toggle surprises an operator after a restart** (a
  deliberately-disabled mailbox silently comes back if it was still
  `enabled` in the env). Mitigation: this is the explicit product decision
  behind this change (see proposal); the UI should visibly label the toggle
  as "until restart" so this isn't a surprise. No spec change needed beyond
  what's already written.
- **No cross-request locking around disable/enable.** Two concurrent calls
  for the same mailbox (e.g. a double-click) could interleave. Existing
  registry methods (`updateSettings`, `withRunnerPaused`) have the same
  property today and rely on each `await` completing before the next call is
  typically issued; this change follows that existing convention rather than
  introducing new locking machinery project-wide.
- **A disable racing a job that starts just before `stop()` is called** is
  already handled by `MailboxRunner.stop()`'s existing `activeRuns` await -
  no new race is introduced here.

## Migration Plan

No data migration. The new env key defaults to `true`, so an existing
deployment that never sets `MAILBOX_<n>_ENABLED` is unaffected. Roll out as
an ordinary deploy; rollback is a plain revert, since no persisted state is
written by the new behavior.
