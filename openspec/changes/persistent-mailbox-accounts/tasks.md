# Tasks

## 1. Configuration and compose

- [x] 1.1 Move `SPAM_SCANNER_DATA` from `dockerComposeDocGroup` into
  `AppConfigSchema` with homedir default, inject `SpamScannerDataConfig`
  (or equivalent), and add `ACCOUNTS_FILENAME` constant for
  `accounts.json`. Verify with `app-config.schema.spec.ts`: valid env parses
  path; server starts without any `MAILBOX_*` keys.
- [x] 1.2 Remove `MailboxesSchema`, `mailboxDocGroup`, and
  `MailboxConnectionsConfig` / dynamic `MAILBOXES` from the schema and
  `app-config.ts`. Verify `app-config.schema.spec.ts` no longer expects
  mailbox env slots and `npm run generate:env-example` drops `MAILBOX_1_*`
  from repo-root `.env.example`.
- [x] 1.3 Bind-mount `${SPAM_SCANNER_DATA}` on the `server` service in
  `docker-compose.yml`. Verify `docker compose config` shows the mount.

## 2. Account store (infrastructure)

- [x] 2.1 Add `AccountRecord` type, `AccountStore` interface (`load`,
  `save(expectedVersion, accounts)` with `VersionConflict`), and
  `JsonFileAccountStore` (mutex, temp+rename, missing file → version 0).
  Verify unit tests: first save creates file; stale version throws;
  concurrent saves serialize.
- [x] 2.2 Add `testImapConnection(mailboxOrParams)` reusing
  `imap-connection.factory` TLS rules. Verify unit/fake-client test: success
  calls connect+logout; failure propagates without persisting.

## 3. Mailbox registry and runner lifecycle

- [x] 3.1 Rewire `MailboxRepository` to map `AccountStore.load()` →
  `Mailbox[]` (include `enabled`, `aiEnabled`). Verify
  `mailbox.repository.spec.ts` uses a fake store.
- [x] 3.2 Extend `RunnerRegistry` for runtime add/update/remove account
  (stop runner, update `mailboxes` map, start when enabled) and bootstrap
  only enabled accounts. Verify `runner-registry.spec.ts`: add account
  starts runner; delete stops; disabled skips runner at bootstrap.
- [x] 3.3 Resolve `aiEnabled` from account in `MailboxRunner` settings
  load (not from IMAP overrides); remove `aiEnabled` from
  `overridableSchema` / `settingsUpdateSchema`. Verify
  `mailbox-settings.schema.spec.ts` rejects `aiEnabled` on PUT settings;
  scan spec still skips AI when account `aiEnabled` false.

## 4. Application orchestration

- [x] 4.1 Add `AccountAdminService`: create/update/delete/setEnabled with
  duplicate-id check, IMAP test, `If-Match`, store save, registry sync.
  Verify unit tests with fake store, fake IMAP test, fake registry: order
  is test-before-save; 409 on version conflict; create duplicate id fails
  before IMAP.

## 5. HTTP API

- [x] 5.1 Add `AccountsController` (`GET/POST/PATCH/DELETE
  /admin/accounts`) with `ETag` on GET, `If-Match` on mutations, no
  passwords in responses. Verify controller or e2e-style unit tests for
  428/409/422 paths.
- [x] 5.2 Remove `mailboxes` from `AdminController.getSettings` and drop
  `MailboxConnectionsConfig` injection there. Verify
  `admin.controller.spec.ts` settings shape has no mailboxes.
- [x] 5.3 Wire admin and mailbox `PUT .../enabled` through
  `AccountAdminService` (persistent + IMAP test + `If-Match`). Verify
  mailbox-scope guard still blocks cross-mailbox ids.

## 6. Frontend

- [x] 6.1 Extend `ApiService` for accounts CRUD and `If-Match` headers;
  update admin page for list/create/edit/delete, version/ETag handling,
  409 refresh. Verify manually or with component test stubs.
- [x] 6.2 Remove "until restart" copy; mailbox owner enable uses same
  persistent API with precondition from a prior accounts or status fetch.
  Verify admin and mailbox pages call updated endpoints.

## 7. Integration and docs

- [x] 7.1 Run `npm run lint` and `npm test` from repo root; fix any
  dependency-cruiser violations for new modules. Verify CI-equivalent pass.
- [x] 7.2 Document manual `accounts.json` shape in change or server README
  snippet for the operator's two legacy mailboxes. Verify example JSON
  validates against zod account schema in a small test.
