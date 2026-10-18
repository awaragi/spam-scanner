# Design

## Context

See `proposal.md`. Today `MailboxRepository` maps
`MailboxConnectionsConfig` (env `MAILBOX_<n>_*` parsed at bootstrap).
`RunnerRegistry` copies `findAll()` into a fixed `mailboxes` map at
bootstrap; enable/disable (if present on the branch) is in-memory only.
`aiEnabled` is an IMAP settings override. Admin `GET /settings` embeds
non-secret mailbox connection fields from env.

## Goals / Non-Goals

**Goals:**

- Single durable account registry under `${SPAM_SCANNER_DATA}/accounts.json`
  (filename is a code constant).
- Replaceable `AccountStore` port; JSON file is the first adapter.
- Live CRUD + persistent enable/disable without process restart.
- Uniform mutation pipeline: authorize → build effective record → IMAP test
  → `If-Match` save → registry sync.
- Admin-only `aiEnabled` on account create/update; owners retain persistent
  enable/disable aligned with admin.
- Clean install: zero accounts, server starts, admin adds first account via UI.

**Non-Goals:**

- Automated import from `MAILBOX_*` env (manual `accounts.json` or a
  one-off script the operator runs).
- Encrypting passwords at rest (plain text in JSON for now).
- SQLite or other store implementations (only the port + JSON adapter).
- Editing app-level settings over HTTP (still env-only).
- Deleting rspamd Bayes data when an account is removed.

## Decisions

### D1. Data path and config

Move `SPAM_SCANNER_DATA` from `dockerComposeDocGroup` into `AppConfigSchema`
with default `path.join(os.homedir(), '.spam-scanner')` when unset. Inject
`SpamScannerDataConfig` (or equivalent) for the resolved absolute path.

Account file path: `join(spamScannerData, ACCOUNTS_FILENAME)` where
`ACCOUNTS_FILENAME` is a fixed constant (e.g. `'accounts.json'`).

**Docker:** Add a bind mount on the `server` service:
`${SPAM_SCANNER_DATA}:${SPAM_SCANNER_DATA}` (same host path inside the
container) so reads/writes hit the host tree next to `rspamd/` and `redis/`.
Alternative considered: mount only a subpath — rejected because operators
already standardize on one `SPAM_SCANNER_DATA` root.

### D2. Account store port and JSON adapter

```text
AccountStore (interface)
  load(): { version: number, accounts: AccountRecord[] }
  save(expectedVersion, accounts): void  // throws VersionConflict

JsonFileAccountStore
  - missing file → { version: 0, accounts: [] } in memory; first save creates file
  - write: temp file in same directory + rename
  - process-wide mutex around read-modify-write
```

`AccountRecord` fields: `id`, IMAP connection fields (including plain
`imapPassword`), `stateFolder`, `enabled`, `aiEnabled`.

Swapping storage later: new `@Injectable()` implementing `AccountStore`,
change module binding; application and API layers unchanged.

Layering (dependency-cruiser):

- `infrastructure/accounts/` — store + IMAP test
- `application/accounts/account-admin.service.ts` — orchestration
- `api/admin/accounts.controller.ts` — HTTP + `If-Match` / `ETag`
- `runtime/runner-registry.ts` — `registerAccount`, `updateAccount`,
  `removeAccount` (names TBD) in addition to existing enable/disable

### D3. Optimistic locking (Option A)

- `GET /admin/accounts` returns `{ version, accounts }` (no passwords) and
  response header `ETag: "<version>"`.
- Mutations require header `If-Match: "<version>"` matching the version from
  the last read. Missing → **428 Precondition Required**. Stale → **409
  Conflict** with current version in body/headers.
- Successful write returns new `version` and updates `ETag`.

Enable endpoints (`PUT .../enabled`) use the same precondition and go through
`AccountAdminService` so locking stays centralized.

### D4. Mutation pipeline (all writes except DELETE)

For POST, PATCH, PUT enabled (admin and owner):

1. Parse body / params; admin guard or mailbox scope as today.
2. **Duplicate id:** on POST, reject if `id` already exists **before** IMAP
   test (400/409).
3. Build **effective** connection (PATCH merges; omitted password → stored).
4. **`testImapConnection(effective)`** — same TLS/`allowInsecure` rules as
   production (`imap-connection.factory` options); connect; logout in
   `finally`. Failure → 422 (or 400), no file write.
5. **`If-Match`** check + `AccountStore.save`.
6. **`RunnerRegistry` sync:** create → add map + start if enabled; update →
   stop if needed, replace `Mailbox`, restart if enabled; enable/disable →
   existing methods after store write.

**DELETE:** no IMAP test; still requires `If-Match`; stop runner; remove
from registry map; save store.

**aiEnabled / enabled-only changes:** same pipeline (IMAP test still runs).

### D5. Mailbox model and settings resolution

Extend `Mailbox` (or equivalent runner input) with `aiEnabled` from the
account record. At runner bootstrap:

```text
resolveMailboxSettings(imapOverrides, { aiEnabled: account.aiEnabled })
```

Remove `aiEnabled` from `overridableSchema` / mailbox `PUT settings`.
Legacy `aiEnabled` key in IMAP settings message → ignored with warning
(treated like a global-only key).

Global rule unchanged: scan uses AI only when
`globalAiConfig.enabled && settings.aiEnabled`.

### D6. API split

- **`AccountsController`** `@Controller('admin/accounts')` — GET, POST,
  PATCH `:id`, DELETE `:id`.
- **`AdminController.getSettings`** — drop `mailboxes` array entirely.
- Enable routes stay on admin/mailbox controllers but delegate to
  `AccountAdminService.setEnabled(mailboxId, enabled, ifMatch)`.

Password rules: required on POST; optional on PATCH (omit = unchanged);
never returned on GET.

### D7. Auth and empty registry

`AuthService.exchangeForMailboxToken` continues to use
`MailboxRepository.findAll()` (backed by store). Zero accounts → exchange
404 for any id. Admin login unaffected.

### D8. Frontend

Admin page: load accounts + version; forms for create/edit; track `ETag` or
version for writes; handle 409/428; remove “until restart” on enable
buttons; mailbox owner page uses same persistent enable API.

## Risks / Trade-offs

- **[Plain-text passwords on disk]** → Document threat model; file permissions
  left to operator; encryption deferred.
- **[IMAP test on every toggle]** → Extra latency on enable/disable; accepted
  for uniform validation and catching bad credentials before persist.
- **[Concurrent admin tabs]** → Optimistic locking + 409; UI refresh/retry.
- **[Docker path]** → Server must mount host data dir; documented in compose
  change.
- **[Partial enable-toggle change on other branches]** → This change supersedes
  env-backed `MAILBOX_*` and non-persistent runtime enable semantics.

## Migration Plan

1. Set `SPAM_SCANNER_DATA` in `.env` (absolute path).
2. Manually author `accounts.json` with `{ "version": 1, "accounts": [...] }`
   for existing mailboxes (defaults for `stateFolder`, `enabled`, `aiEnabled`).
3. Remove `MAILBOX_*` keys from `.env`.
4. Deploy server with compose volume mount; verify CRUD and restart
   persistence.

Rollback: restore `.env` mailboxes and previous server image; delete or
ignore `accounts.json`.

## Open Questions

None — decisions from exploration are captured above.
