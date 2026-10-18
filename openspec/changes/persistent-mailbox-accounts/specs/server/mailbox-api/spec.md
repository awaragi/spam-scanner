# Spec Delta

## MODIFIED Requirements

### Requirement: An admin can list every managed mailbox and its runner status
The server SHALL expose an admin-scoped endpoint that returns every mailbox
the server manages, each with its current runner status, including whether
the mailbox is enabled or disabled, whether it is running or degraded,
whether it runs in IDLE or polling mode, and the per-job status the runner
already tracks. For a disabled mailbox, the server SHALL report it as
disabled without a degraded, IDLE/polling, or per-job status. Enabled state
SHALL reflect the persisted account store, not environment variables.

#### Scenario: Admin lists mailboxes with status
- **WHEN** a caller with a valid admin token requests the mailbox list
- **THEN** the server returns each managed mailbox's id and its runner
  status, including whether it is enabled or disabled

#### Scenario: A disabled mailbox appears in the list without runner status
- **WHEN** a caller with a valid admin token requests the mailbox list and
  one managed mailbox is currently disabled
- **THEN** the server includes that mailbox in the response, reports it as
  disabled, and reports no degraded, IDLE/polling, or per-job status for it

### Requirement: An admin can read server health
The server SHALL expose an admin-scoped health endpoint that reports whether
the server is up, whether rspamd is reachable, the global AI failure status,
and a per-mailbox summary reporting for each mailbox whether it is enabled
or disabled, and, for an enabled mailbox, whether it is running or
degraded, whether it is in IDLE or polling mode, and the age of its last
successful scan.

#### Scenario: Health reports rspamd and AI status
- **WHEN** a caller with a valid admin token requests the health endpoint
- **THEN** the server returns overall liveness, rspamd reachability, the
  global AI failure status, and a per-mailbox running/degraded summary

#### Scenario: Health reflects rspamd being unreachable
- **WHEN** rspamd is unreachable and a caller requests the health endpoint
- **THEN** the health response reports rspamd as unreachable rather than
  failing the whole request

#### Scenario: Health reports a disabled mailbox without running/degraded status
- **WHEN** a caller with a valid admin token requests the health endpoint
  and one managed mailbox is currently disabled
- **THEN** the per-mailbox summary reports that mailbox as disabled, with no
  running/degraded status or last-successful-scan age for it

### Requirement: An admin can read app-level settings
The server SHALL expose an admin-scoped endpoint that returns the server's
app-level settings. Secret values, including credentials and the token
signing secret, SHALL NOT be returned. The response SHALL NOT include
mailbox connection info or account lists; those are exposed only through
the admin accounts API. Editing app-level settings is out of scope for this
capability and remains environment-only.

#### Scenario: App settings are returned without secrets
- **WHEN** a caller with a valid admin token requests app settings
- **THEN** the server returns non-secret app settings and omits every
  credential and signing secret

#### Scenario: App settings omit mailbox accounts
- **WHEN** a caller with a valid admin token requests app settings
- **THEN** the response does not contain mailbox connection fields or a
  list of managed mailboxes

### Requirement: A mailbox token holder can read and update that mailbox's settings
The server SHALL expose mailbox-scoped endpoints to read the mailbox's
currently resolved settings and to update its settings overrides. An update
SHALL apply through the server's existing update-by-restart behavior:
validate the overrides, stop the mailbox's runner, write the new settings,
and start a fresh runner. An update that fails validation SHALL be rejected
without stopping the runner or writing anything. A settings update SHALL
NOT accept `aiEnabled`; per-mailbox AI enablement is changed only through
admin account create/update.

#### Scenario: Reading settings returns the resolved settings
- **WHEN** a mailbox token holder reads its mailbox's settings
- **THEN** the server returns the settings currently in effect for that
  mailbox, including `aiEnabled` as resolved from the account store

#### Scenario: A valid update restarts the mailbox with new settings
- **WHEN** a mailbox token holder submits a valid settings update
- **THEN** the server validates it, writes the new settings, and the
  mailbox's fresh runner uses them

#### Scenario: An invalid update is rejected without side effects
- **WHEN** a mailbox token holder submits a settings update that fails
  validation
- **THEN** the server rejects the request and the mailbox's runner and stored
  settings are left unchanged

#### Scenario: Settings update rejects aiEnabled
- **WHEN** a mailbox token holder submits a settings update that includes
  `aiEnabled`
- **THEN** the server rejects the request as invalid input before stopping
  the runner or writing settings

## ADDED Requirements

### Requirement: An admin can list and manage mailbox accounts
The server SHALL expose admin-scoped endpoints under `/admin/accounts` to
list all account records, create an account, update an account by id, and
delete an account by id. List and read responses SHALL omit IMAP passwords.
Create SHALL require a password. Update SHALL treat an omitted password as
unchanged. Every mutating request SHALL require a valid `If-Match` header
per the `server/mailbox-accounts` capability. Successful mutations SHALL
update the live mailbox registry without restarting the server process.

#### Scenario: Admin lists accounts without passwords
- **WHEN** a caller with a valid admin token requests the account list
- **THEN** the server returns the file version and each account's non-secret
  fields, including `enabled` and `aiEnabled`

#### Scenario: Admin creates an account
- **WHEN** an admin submits a valid create with matching `If-Match` and
  successful IMAP test
- **THEN** the account is stored, the file version increments, and a runner
  is started when `enabled` is true

#### Scenario: Admin deletes an account
- **WHEN** an admin deletes an account with valid `If-Match`
- **THEN** the account is removed from the store, its runner is stopped if
  present, and mailbox token exchange for that id subsequently fails

### Requirement: An admin can enable or disable any managed mailbox's runner with persistence
The server SHALL expose an admin-scoped endpoint that enables or disables a
named mailbox's runner. The change SHALL be persisted in the account store
(after a successful IMAP connection test and valid `If-Match`) and SHALL
update the runner registry immediately. Disabling SHALL use graceful stop;
enabling SHALL start a fresh runner.

#### Scenario: Admin disables a mailbox persistently
- **WHEN** an admin disables a mailbox with valid preconditions and IMAP test
- **THEN** the account store records `enabled: false`, the runner stops, and
  a process restart still leaves that mailbox disabled

#### Scenario: Admin re-enables a mailbox
- **WHEN** an admin enables a disabled mailbox with valid preconditions and
  IMAP test
- **THEN** the account store records `enabled: true` and a fresh runner starts

### Requirement: A mailbox token holder can enable or disable only its own mailbox's runner with persistence
The server SHALL expose a mailbox-scoped endpoint that enables or disables
the runner for the mailbox the caller's token is scoped to. The change SHALL
be persisted in the account store with the same IMAP test and `If-Match`
requirements as the admin enable endpoint. A mailbox token SHALL NOT enable
or disable any other mailbox.

#### Scenario: Mailbox owner disables its own mailbox persistently
- **WHEN** a mailbox token holder disables its mailbox with valid
  preconditions and IMAP test
- **THEN** the account store records `enabled: false` for that id and the
  runner stops

#### Scenario: A mailbox token cannot change another mailbox's enabled state
- **WHEN** a mailbox token holder attempts to enable or disable a different
  mailbox id
- **THEN** the server rejects the request and the target's enabled state is
  unchanged
