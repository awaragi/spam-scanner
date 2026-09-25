# Spec Delta

## Purpose

Defines the HTTP surface for controlling the server: admin-scoped endpoints
for listing mailboxes and reading health, and mailbox-scoped endpoints for
triggering jobs and managing a single mailbox's settings, scanner state, and
sender lists.

## ADDED Requirements

### Requirement: A liveness endpoint is reachable without authentication
The server SHALL expose a minimal liveness endpoint that reports the process
is up, reachable without any token. This endpoint SHALL NOT expose mailbox
data, credentials, or any privileged status detail.

#### Scenario: Liveness responds without a token
- **WHEN** an unauthenticated caller requests the liveness endpoint
- **THEN** the server responds indicating it is up, without requiring a token

### Requirement: An admin can list every managed mailbox and its runner status
The server SHALL expose an admin-scoped endpoint that returns every mailbox
the server manages, each with its current runner status, including whether
the mailbox is running or degraded, whether it runs in IDLE or polling mode,
and the per-job status the runner already tracks.

#### Scenario: Admin lists mailboxes with status
- **WHEN** a caller with a valid admin token requests the mailbox list
- **THEN** the server returns each managed mailbox's id and its runner status

### Requirement: An admin can read server health
The server SHALL expose an admin-scoped health endpoint that reports whether
the server is up, whether rspamd is reachable, the global AI failure status,
and a per-mailbox summary reporting for each mailbox whether it is running or
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

### Requirement: An admin can read app-level settings
The server SHALL expose an admin-scoped endpoint that returns the server's
app-level settings. Secret values, including credentials and the token
signing secret, SHALL NOT be returned. Editing app-level settings is out of
scope for this capability and remains environment-only.

#### Scenario: App settings are returned without secrets
- **WHEN** a caller with a valid admin token requests app settings
- **THEN** the server returns non-secret app settings and omits every
  credential and signing secret

### Requirement: A mailbox token holder can trigger any of that mailbox's jobs on demand
The server SHALL expose a mailbox-scoped endpoint that triggers a named job
for the mailbox on demand: scanning, each of the training jobs, and
folder initialization. Triggering SHALL reuse the runner's existing
coalescing so an on-demand trigger while a job is already running does not
run it concurrently. An unrecognized job name SHALL be rejected as invalid
input.

#### Scenario: Triggering a scan runs it through the runner
- **WHEN** a mailbox token holder triggers the scan job for its mailbox
- **THEN** the server invokes the mailbox's runner to run that job, subject
  to the runner's existing coalescing

#### Scenario: An unknown job name is rejected
- **WHEN** a caller triggers a job whose name is not one of the supported
  jobs
- **THEN** the server rejects the request as invalid input

#### Scenario: Triggering folder initialization is supported
- **WHEN** a mailbox token holder triggers folder initialization for its
  mailbox
- **THEN** the server ensures the mailbox's configured folders exist, through
  the same folder-initialization the runner performs at bootstrap

### Requirement: A mailbox token holder can read and update that mailbox's settings
The server SHALL expose mailbox-scoped endpoints to read the mailbox's
currently resolved settings and to update its settings overrides. An update
SHALL apply through the server's existing update-by-restart behavior:
validate the overrides, stop the mailbox's runner, write the new settings,
and start a fresh runner. An update that fails validation SHALL be rejected
without stopping the runner or writing anything.

#### Scenario: Reading settings returns the resolved settings
- **WHEN** a mailbox token holder reads its mailbox's settings
- **THEN** the server returns the settings currently in effect for that
  mailbox

#### Scenario: A valid update restarts the mailbox with new settings
- **WHEN** a mailbox token holder submits a valid settings update
- **THEN** the server validates it, writes the new settings, and the
  mailbox's fresh runner uses them

#### Scenario: An invalid update is rejected without side effects
- **WHEN** a mailbox token holder submits a settings update that fails
  validation
- **THEN** the server rejects the request and the mailbox's runner and stored
  settings are left unchanged

### Requirement: A mailbox token holder can read and reset that mailbox's scanner state
The server SHALL expose mailbox-scoped endpoints to read the mailbox's
scanner state and to reset it. Reading SHALL return the stored scanner state,
or report that none exists. Resetting SHALL delete the stored scanner state
so the next scan re-establishes it.

#### Scenario: Reading scanner state returns it
- **WHEN** a mailbox token holder reads its mailbox's scanner state and a
  state message exists
- **THEN** the server returns the stored scanner state

#### Scenario: Resetting scanner state deletes it
- **WHEN** a mailbox token holder resets its mailbox's scanner state
- **THEN** the server deletes the stored scanner state, and a subsequent read
  reports that none exists

### Requirement: A mailbox token holder can manage that mailbox's sender lists
The server SHALL expose mailbox-scoped endpoints to read, replace, export,
and import the mailbox's whitelist and blacklist. Reading and exporting SHALL
return the list's current addresses. Replacing SHALL store the supplied
addresses as the complete new list. Importing SHALL accept a supplied set of
addresses and store them as the list, replacing prior content. Address input
SHALL be validated, and invalid input SHALL be rejected without changing the
stored list.

#### Scenario: Reading a list returns its addresses
- **WHEN** a mailbox token holder reads its mailbox's whitelist or blacklist
- **THEN** the server returns that list's current addresses

#### Scenario: Replacing a list stores the new addresses
- **WHEN** a mailbox token holder replaces its whitelist or blacklist with a
  supplied set of addresses
- **THEN** the server stores exactly those addresses as the complete list

#### Scenario: Invalid list input is rejected without changing the stored list
- **WHEN** a mailbox token holder submits list content that fails validation
- **THEN** the server rejects the request and the stored list is unchanged

### Requirement: Request bodies are validated before any privileged action
The server SHALL validate every request body against a schema for that route
before performing any privileged action. A request whose body fails
validation SHALL be rejected as invalid input, and SHALL NOT trigger a job,
write settings, reset state, or modify a list.

#### Scenario: A malformed body never reaches the privileged action
- **WHEN** a caller submits a request whose body fails its route's schema
- **THEN** the server rejects it as invalid input before any job trigger,
  settings write, state reset, or list modification occurs
