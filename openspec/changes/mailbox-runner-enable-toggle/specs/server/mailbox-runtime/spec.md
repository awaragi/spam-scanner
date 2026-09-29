# Spec Delta

## MODIFIED Requirements

### Requirement: The server runs one independent runner per mailbox
For every mailbox returned by the mailbox registry whose resolved enabled
state is true, the server SHALL run one runner responsible for that
mailbox's jobs, independently of every other mailbox's runner. A failure in
one mailbox's runner SHALL NOT affect any other mailbox's runner, and SHALL
NOT stop the server process. The server SHALL NOT start a runner, at
bootstrap, for a mailbox whose resolved enabled state is false.

#### Scenario: One mailbox fails while another keeps working
- **WHEN** one mailbox's connection repeatedly fails while a second
  mailbox's jobs continue succeeding
- **THEN** the second mailbox's scans and training continue running on
  schedule, unaffected by the first mailbox's failures

#### Scenario: A disabled mailbox has no runner at bootstrap
- **WHEN** the server starts and one configured mailbox's resolved enabled
  state is false
- **THEN** the server does not start a runner for that mailbox, while every
  other, enabled mailbox's runner starts normally

### Requirement: Each mailbox's runner exposes its current status
For each mailbox, the server SHALL make available: whether that mailbox is
currently enabled or disabled, whether it is currently reported as
degraded, whether it is using IMAP IDLE or interval polling, and for each
of its jobs — the time and result of its last run, its current
consecutive-failure count, and (when applicable) when its next automatic
attempt is eligible to run. For a disabled mailbox, only its enabled state
is meaningful; it has no runner and therefore no degraded state, IDLE/polling
mode, or per-job status to report.

#### Scenario: Status reflects a currently degraded job
- **WHEN** a mailbox's scan job has failed twice in a row and is currently
  within its backoff delay
- **THEN** that mailbox's exposed status shows it as degraded, shows the
  scan job's consecutive-failure count as two, and shows when the scan
  job's next automatic attempt is eligible

#### Scenario: Status reflects a disabled mailbox
- **WHEN** a mailbox is currently disabled
- **THEN** that mailbox's exposed status shows it as disabled, with no
  degraded, IDLE/polling, or per-job status

## ADDED Requirements

### Requirement: A mailbox's runner can be stopped and started at runtime, independent of process restarts
The server SHALL support disabling and re-enabling a specific mailbox's
runner while the process keeps running, without affecting any other
mailbox's runner. Disabling an enabled mailbox SHALL stop its runner using
the same graceful-shutdown behavior the runner already uses when the whole
process shuts down: any job run already in progress for that mailbox is
allowed to finish on its own, including closing its own IMAP connection,
and no new job run is started for that mailbox from the point disabling
begins. Enabling a disabled mailbox SHALL start a fresh runner for it,
following the same bootstrap sequence used when the server process starts.

A runtime change to a mailbox's enabled state SHALL only affect the current
process's in-memory state. It SHALL NOT be persisted anywhere. When the
process restarts, every mailbox's enabled state SHALL again be resolved
solely from its configured enabled key, discarding any runtime change made
before the restart.

#### Scenario: Disabling a running mailbox stops it gracefully
- **WHEN** an enabled mailbox with a job currently in progress is disabled
  at runtime
- **THEN** the in-progress job is allowed to finish and close its own
  connection, no new job run starts for that mailbox afterward, and no
  other mailbox's runner is affected

#### Scenario: Enabling a disabled mailbox starts a fresh runner
- **WHEN** a mailbox that currently has no runner is enabled at runtime
- **THEN** the server constructs and starts a new runner for that mailbox,
  following the same bootstrap sequence used at process startup

#### Scenario: A runtime toggle does not survive a restart
- **WHEN** a mailbox configured as enabled is disabled at runtime, and the
  server process is then restarted
- **THEN** after restart, that mailbox's runner starts normally, because its
  enabled state is resolved again from its configured enabled key rather
  than from the runtime change made before the restart
