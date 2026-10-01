# Spec Delta

## MODIFIED Requirements

### Requirement: The server runs one independent runner per mailbox
For every enabled mailbox returned by the mailbox registry, the server SHALL
run one runner responsible for that mailbox's jobs, independently of every
other mailbox's runner. The server SHALL NOT start a runner for a mailbox
whose account record has `enabled` false. A failure in one mailbox's runner
SHALL NOT affect any other mailbox's runner, and SHALL NOT stop the server
process. When an account is added, updated, or removed at runtime, the server
SHALL start, restart, or stop the corresponding runner without restarting
the whole process.

#### Scenario: One mailbox fails while another keeps working
- **WHEN** one mailbox's connection repeatedly fails while a second
  mailbox's jobs continue succeeding
- **THEN** the second mailbox's scans and training continue running on
  schedule, unaffected by the first mailbox's failures

#### Scenario: Disabled mailbox has no runner
- **WHEN** a mailbox's account record has `enabled` false
- **THEN** the server does not run a runner for that mailbox

#### Scenario: New account starts a runner without process restart
- **WHEN** an admin creates an enabled account and persistence succeeds
- **THEN** the server starts a runner for that mailbox while other runners
  continue unchanged

## ADDED Requirements

### Requirement: Account updates restart the affected runner when needed
When an account's connection fields or `aiEnabled` change, the server SHALL
stop the mailbox's existing runner (if any), apply the updated mailbox
snapshot, and start a fresh runner when the account remains enabled. When an
account is removed, the server SHALL stop its runner and remove it from the
active registry.

#### Scenario: Connection update restarts runner
- **WHEN** an admin updates a mailbox's IMAP host and persistence succeeds
- **THEN** the server stops the previous runner and starts a new runner using
  the updated connection

#### Scenario: Removing an account stops its runner
- **WHEN** an admin deletes a mailbox account
- **THEN** the server stops that mailbox's runner and subsequent triggers
  for that id are rejected as unknown

### Requirement: Persisted enabled state survives process restart
The enabled or disabled state of each mailbox SHALL be read from the account
store on process startup. A mailbox disabled through the API before restart
SHALL remain disabled after restart; an enabled mailbox SHALL have a runner
started again on startup subject to the same bootstrap rules as the initial
start.

#### Scenario: Disabled mailbox stays disabled after restart
- **WHEN** a mailbox was disabled through the API and the server process
  restarts
- **THEN** no runner starts for that mailbox until it is enabled again
