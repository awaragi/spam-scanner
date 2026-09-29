# Spec Delta

## MODIFIED Requirements

### Requirement: An admin can list every managed mailbox and its runner status
The server SHALL expose an admin-scoped endpoint that returns every mailbox
the server manages, each with its current runner status, including whether
the mailbox is enabled or disabled, whether it is running or degraded,
whether it runs in IDLE or polling mode, and the per-job status the runner
already tracks. For a disabled mailbox, the server SHALL report it as
disabled without a degraded, IDLE/polling, or per-job status.

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

## ADDED Requirements

### Requirement: An admin can enable or disable any managed mailbox's runner
The server SHALL expose an admin-scoped endpoint that enables or disables a
named mailbox's runner at runtime. The admin caller SHALL be able to target
any mailbox the server manages, regardless of who owns it. Disabling SHALL
apply the graceful-stop behavior, and enabling SHALL apply the fresh-runner-
start behavior, defined by the `server/mailbox-runtime` capability. The
change SHALL take effect immediately and SHALL be reflected in the mailbox
listing and health endpoints, without being persisted beyond the current
process.

#### Scenario: Admin disables a mailbox
- **WHEN** an admin token holder disables a specific managed mailbox
- **THEN** the server stops that mailbox's runner gracefully, and the
  mailbox subsequently appears as disabled in the mailbox list and health
  endpoints

#### Scenario: Admin re-enables a mailbox
- **WHEN** an admin token holder enables a specific managed mailbox that is
  currently disabled
- **THEN** the server starts a fresh runner for that mailbox, and the
  mailbox subsequently appears as enabled in the mailbox list and health
  endpoints

#### Scenario: Admin can disable a mailbox it does not own
- **WHEN** an admin token holder disables a mailbox other than their own
- **THEN** the server accepts the request and disables that mailbox's
  runner, because an admin token is not scoped to a single mailbox

### Requirement: A mailbox token holder can enable or disable only its own mailbox's runner
The server SHALL expose a mailbox-scoped endpoint that enables or disables
the runner for the mailbox the caller's token is scoped to. A mailbox token
SHALL NOT be able to enable or disable any mailbox other than its own.
Disabling and enabling SHALL apply the same graceful-stop and fresh-runner-
start behavior as the admin-scoped endpoint.

#### Scenario: Mailbox owner disables its own mailbox
- **WHEN** a mailbox token holder disables the mailbox its token is scoped
  to
- **THEN** the server stops that mailbox's runner gracefully, and the
  mailbox subsequently appears as disabled

#### Scenario: Mailbox owner re-enables its own mailbox
- **WHEN** a mailbox token holder enables the mailbox its token is scoped
  to, and that mailbox is currently disabled
- **THEN** the server starts a fresh runner for that mailbox

#### Scenario: A mailbox token cannot disable a different mailbox
- **WHEN** a mailbox token holder attempts to enable or disable a mailbox
  other than the one its token is scoped to
- **THEN** the server rejects the request and the target mailbox's runner
  state is unchanged
