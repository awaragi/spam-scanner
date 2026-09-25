# Spec Delta

## Purpose

Governs how the server runs jobs against each mailbox over time: the split
between jobs and what triggers them, how concurrent triggers for the same
job are coalesced rather than queued or dropped, how the server chooses
between IMAP IDLE and interval polling, and how a persistently failing
mailbox is retried without ever stopping the process.

## ADDED Requirements

### Requirement: The server runs one independent runner per mailbox
For every mailbox returned by the mailbox registry, the server SHALL run
one runner responsible for that mailbox's jobs, independently of every
other mailbox's runner. A failure in one mailbox's runner SHALL NOT affect
any other mailbox's runner, and SHALL NOT stop the server process.

#### Scenario: One mailbox fails while another keeps working
- **WHEN** one mailbox's connection repeatedly fails while a second
  mailbox's jobs continue succeeding
- **THEN** the second mailbox's scans and training continue running on
  schedule, unaffected by the first mailbox's failures

### Requirement: Jobs are triggered, never invoked directly by a trigger source
The server SHALL define, per mailbox, the following jobs: scanning the
inbox, and training against each of the spam, ham, whitelist, and
blacklist training folders. Each of the following SHALL be able to trigger
a job to run, without itself containing the job's logic: a recurring
global interval, an IMAP IDLE notification (for the scan job only), and an
on-demand request.

#### Scenario: The same job logic runs regardless of trigger source
- **WHEN** the scan job is triggered once by the global interval and once
  by an IDLE notification, on separate occasions
- **THEN** both invocations run the identical scan logic and produce the
  same behavior for the same inbox state

### Requirement: A job never runs concurrently with itself for the same mailbox
For a given mailbox and job, the server SHALL NOT start a new run of that
job while a run of it is already in progress.

#### Scenario: A trigger fires while the job is still running
- **WHEN** the global interval elapses again for a mailbox while that
  mailbox's scan job from the previous interval is still running
- **THEN** no second, concurrent scan run starts for that mailbox

### Requirement: A trigger that arrives while a job is running is coalesced into exactly one more run
When one or more triggers for a job arrive while that job is already
running, the server SHALL run that job exactly one more time after the
current run finishes, rather than queuing a separate run per trigger or
silently dropping the trigger.

#### Scenario: Three triggers arrive during one run
- **WHEN** three separate triggers for the same mailbox's scan job arrive
  while a scan run for that mailbox is in progress
- **THEN** exactly one additional scan run starts after the in-progress run
  finishes, not three, and not zero

### Requirement: Each job run opens and closes its own IMAP connection
Each time a job runs, the server SHALL open a new IMAP connection for that
run and close it when the run finishes, regardless of whether the run
succeeded or failed.

#### Scenario: A job fails partway through
- **WHEN** a training job's run throws partway through its work
- **THEN** the IMAP connection opened for that run is still closed before
  the failure is handled

### Requirement: IMAP IDLE is used only when the mailbox's server actually supports it
For each mailbox, the server SHALL determine whether the mailbox's IMAP
server supports the IDLE capability by checking that server's advertised
capabilities directly, rather than relying on a client library's own
fallback behavior that could substitute polling for IDLE without the
server's caller being able to tell the difference. This determination SHALL
be made once, after the mailbox's first successful connection, and SHALL
NOT be re-checked again before the process restarts.

#### Scenario: The mailbox's server does not advertise IDLE
- **WHEN** a mailbox's IMAP server does not advertise the IDLE capability
  on connection
- **THEN** the server does not attempt to hold an IDLE connection for that
  mailbox for the remainder of the process's lifetime, and relies on the
  global interval to trigger that mailbox's scan job instead

#### Scenario: The mailbox's server advertises IDLE
- **WHEN** a mailbox's IMAP server advertises the IDLE capability on
  connection
- **THEN** the server holds a dedicated IDLE connection for that mailbox,
  and a new-mail notification on that connection triggers the scan job

### Requirement: An IDLE connection failure does not permanently disable IDLE for that mailbox
When a mailbox's dedicated IDLE connection drops or errors after having
been established, the server SHALL treat this as an ordinary, recoverable
failure and attempt to re-establish the IDLE connection, rather than
falling back to interval-only polling for the rest of the process's
lifetime.

#### Scenario: The IDLE connection drops mid-process
- **WHEN** a mailbox's established IDLE connection drops unexpectedly
- **THEN** the server attempts to re-establish an IDLE connection for that
  mailbox rather than permanently switching it to interval-only polling

### Requirement: One global interval drives training for every mailbox, and is a safety net for scanning
The server SHALL read a single, global interval value that applies
identically to every mailbox and cannot be overridden per mailbox. This
interval SHALL trigger every training job for every mailbox. For a mailbox
using IMAP IDLE, this same interval SHALL also trigger the scan job, so
that a silently failed or stalled IDLE connection does not prevent scanning
indefinitely.

#### Scenario: The interval triggers a scan even while IDLE is active
- **WHEN** a mailbox is using IDLE and the global interval elapses with no
  IDLE notification having occurred
- **THEN** the scan job still runs for that mailbox, triggered by the
  interval

### Requirement: A mailbox in enough consecutive job failures is reported as degraded, and retries with capped exponential backoff
When a job for a mailbox fails, the server SHALL record that failure
against that specific job, and SHALL delay that job's next automatic
attempt using an exponentially increasing delay, capped at a maximum
delay, based on that job's own count of consecutive failures. A mailbox
SHALL be reported as degraded whenever any of its jobs currently has one or
more consecutive failures recorded. The server process SHALL NOT exit, and
no other mailbox's runner SHALL be affected, because of a mailbox's
degraded state.

#### Scenario: A job fails repeatedly and its retries space out
- **WHEN** a mailbox's scan job fails on three consecutive automatic
  attempts
- **THEN** the delay before the fourth automatic attempt is longer than
  the delay before the third, up to the configured maximum delay

#### Scenario: A successful run clears that job's degraded contribution
- **WHEN** a mailbox's scan job, having previously failed, next runs
  successfully
- **THEN** that job's consecutive-failure count resets to zero, and it no
  longer contributes to that mailbox being reported as degraded

#### Scenario: One job's failures do not delay a different, unrelated job
- **WHEN** a mailbox's scan job is currently delayed by backoff after
  repeated failures, and that mailbox's training jobs have not failed
- **THEN** the training jobs continue to run on their normal schedule,
  unaffected by the scan job's backoff

### Requirement: An on-demand trigger for a job bypasses backoff and resets it
When a job is triggered on demand rather than by the interval or IDLE, the
server SHALL run that job immediately regardless of any backoff delay
currently in effect for it, and SHALL reset that job's consecutive-failure
count and backoff delay before doing so.

#### Scenario: An on-demand trigger during backoff
- **WHEN** a job is currently delayed by backoff after repeated failures,
  and an on-demand trigger for that same job arrives
- **THEN** the job runs immediately, and if it succeeds, that job's
  consecutive-failure count is zero afterward

### Requirement: Each mailbox's runner exposes its current status
For each mailbox, the server SHALL make available: whether that mailbox is
currently reported as degraded, whether it is using IMAP IDLE or interval
polling, and for each of its jobs — the time and result of its last run,
its current consecutive-failure count, and (when applicable) when its next
automatic attempt is eligible to run.

#### Scenario: Status reflects a currently degraded job
- **WHEN** a mailbox's scan job has failed twice in a row and is currently
  within its backoff delay
- **THEN** that mailbox's exposed status shows it as degraded, shows the
  scan job's consecutive-failure count as two, and shows when the scan
  job's next automatic attempt is eligible

### Requirement: Shutdown stops new jobs from starting without aborting in-flight work
When the server begins shutting down, it SHALL stop starting any new job
run, for any mailbox, for any trigger. It SHALL NOT forcibly abort a job
run already in progress; a job already running SHALL be allowed to finish
on its own, including closing its own IMAP connection.

#### Scenario: Shutdown while a job is running
- **WHEN** the server begins shutting down while one mailbox's training job
  is in progress
- **THEN** that in-progress job is allowed to finish and close its own
  connection, and no new job run starts for any mailbox from that point on
