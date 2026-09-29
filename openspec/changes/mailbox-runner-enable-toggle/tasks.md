# Tasks

## 1. Config schema

- [ ] 1.1 Add an `enabled` field to `RawMailboxSlot` in
  `server/src/config/app-config.schema.ts`, parsed from `MAILBOX_<n>_ENABLED`
  via the existing `boolField(true)` helper pattern (default `true`), and add
  it to `MailboxConnectionConfig`. Verify with a `app-config.schema.spec.ts`
  case (or extend the existing one) asserting: unset → `enabled: true`,
  `"false"` → `enabled: false`, `"true"` → `enabled: true`.
- [ ] 1.2 Add `enabled` to the `mailboxDocGroup` template in the same file
  so it is documented in the generated example file, then run
  `npm run generate:env-example -w server` and verify
  `server/.env.example` picks up `MAILBOX_1_ENABLED` /
  `MAILBOX_2_ENABLED` with its default and description.

## 2. Mailbox registry

- [ ] 2.1 Add `enabled: boolean` to the `Mailbox` interface in
  `server/src/infrastructure/mailboxes/mailbox.ts` and thread it through
  `MailboxRepository.findAll()` in `mailbox.repository.ts`. Verify with a
  `mailbox.repository.spec.ts` case asserting a mailbox with
  `enabled: false` in its connection config maps to `enabled: false` on the
  returned `Mailbox`.

## 3. Runtime: bootstrap gating and enable/disable

- [ ] 3.1 In `server/src/runtime/runner-registry.ts`, add a
  `mailboxes: Map<string, Mailbox>` populated from
  `mailboxRepository.findAll()` in `onApplicationBootstrap()`, and change the
  bootstrap loop to construct+start a `MailboxRunner` only for mailboxes
  whose `enabled` is `true`. Verify with a `runner-registry.spec.ts` case:
  given one enabled and one disabled mailbox from a fake repository, only
  the enabled one has a runner constructed/started after bootstrap.
- [ ] 3.2 Add `disableMailbox(mailboxId)`: throw
  `Error('Unknown mailbox: ...')` if absent from `mailboxes`; if a runner
  exists in `runners`, `await` its `stop()` then remove it from `runners`;
  no-op (but still resolves) if already disabled. Verify: disabling a
  mailbox with an in-progress job awaits that job's completion before
  resolving (reuse the existing `stop()`-awaits-`activeRuns` behavior;
  assert via a fake runner/job that completion happens before the promise
  resolves), and that a second `disableMailbox` call for an already-disabled
  mailbox resolves without error.
- [ ] 3.3 Add `enableMailbox(mailboxId)`: throw the same
  `Error('Unknown mailbox: ...')` if absent from `mailboxes`; no-op if a
  runner already exists in `runners`; otherwise construct a fresh
  `MailboxRunner` from `mailboxes.get(mailboxId)`, fire-and-forget
  `.start()`, and `runners.set(...)`. Verify with a `runner-registry.spec.ts`
  case: enabling a previously-disabled mailbox results in a new runner
  present in status output, and enabling an already-enabled mailbox is a
  no-op (same runner instance, not replaced).
- [ ] 3.4 Extend whatever `RunnerRegistry` method backs per-mailbox status
  (`getStatus` / `getMailboxStatus`) to report `enabled: boolean` for every
  id in `mailboxes`, and to omit degraded/IDLE-polling/per-job fields when
  `enabled` is `false` rather than looking them up on a nonexistent runner.
  Verify with a `runner-registry.spec.ts` case covering both an enabled and
  a disabled mailbox in the same status response.

## 4. API endpoints

- [ ] 4.1 Add a Zod schema for the enable/disable request body (`{ enabled:
  boolean }`) alongside `server/src/api/mailbox/settings-update.schema.ts`
  (or a new sibling file), validated via the existing `ZodValidationPipe`.
- [ ] 4.2 Add `PUT 'mailboxes/:mailboxId/enabled'` to
  `server/src/api/mailbox/mailbox.controller.ts`, guarded by the
  controller's existing `MailboxScopeGuard`, calling
  `runnerRegistry.disableMailbox`/`enableMailbox` based on the body and
  translating "Unknown mailbox" to 404 via the existing
  `withUnknownMailboxAsNotFoundAsync` helper. Verify with a controller/e2e
  test: a mailbox token for mailbox A cannot toggle mailbox B (403 from the
  existing guard, unchanged), and a valid call flips A's status as reported
  by the next status read.
- [ ] 4.3 Add `PUT 'mailboxes/:mailboxId/enabled'` to
  `server/src/api/admin/admin.controller.ts`, guarded by `AdminGuard`, same
  body/validation, calling the same registry methods with no
  mailbox-ownership restriction. Verify with a controller/e2e test: an admin
  token can disable a mailbox regardless of ownership.
- [ ] 4.4 Extend the admin mailbox-list and health response shapes (same
  controller) to include each mailbox's `enabled` state, omitting
  degraded/IDLE-polling/per-job fields for a disabled mailbox. Verify with
  an existing or extended admin-controller test asserting the response
  shape for a mix of enabled and disabled mailboxes.

## 5. Frontend (manual testing)

- [ ] 5.1 Add an authenticated admin `PUT` method to
  `front/src/app/core/api.service.ts` (mirroring the existing `mailboxPut`
  shape, since only `adminGet` exists today).
- [ ] 5.2 Add an enable/disable toggle button per mailbox row in
  `front/src/app/pages/admin/admin.component.ts`, reading each mailbox's
  initial state from the extended `/admin/mailboxes` response and calling
  the new admin `PUT /admin/mailboxes/:id/enabled`. Verify manually: toggle
  a mailbox off/on from the admin list and confirm the row's status updates
  after the call resolves.
- [ ] 5.3 Add an enable/disable toggle button to
  `front/src/app/pages/mailbox/mailbox.component.ts`, reading the signed-in
  mailbox's initial state and calling the existing `mailboxPut` against
  `PUT mailboxes/:id/enabled`. Verify manually: sign in as a mailbox owner,
  toggle the mailbox off/on, and confirm the status updates.

## 6. Integration verification

- [ ] 6.1 Run `npm run lint` and `npm test` from the repo root (`turbo run
  lint`/`test`) and verify both pass across `server` and `front`.
- [ ] 6.2 Manually verify end-to-end: set `MAILBOX_2_ENABLED=false` in a
  local `.env`, start the server, confirm via `GET /admin/mailboxes` that
  only mailbox 1 has a runner and mailbox 2 reports `enabled: false`; then
  enable mailbox 2 via the admin API/UI and confirm a runner starts for it
  without restarting the process; then disable mailbox 1 while a job is
  running and confirm the in-progress job completes before its runner stops.
