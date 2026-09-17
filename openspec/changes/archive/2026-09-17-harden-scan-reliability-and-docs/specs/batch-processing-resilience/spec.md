# Spec Delta

## Purpose

Prevents a single unprocessable message from blocking an entire scan or training batch, by isolating per-message failures and only failing (and retrying) the batch as a whole for genuinely transient errors.

## ADDED Requirements

### Requirement: Per-message failure isolation during scanning
When checking a batch of messages against rspamd, a failure for one message SHALL NOT prevent the other messages in the batch from being processed and included in the batch's results.

#### Scenario: One message fails, others succeed
- **WHEN** a scan batch contains multiple messages and the rspamd check for exactly one of them fails
- **THEN** the other messages in the batch SHALL still be checked, categorized, and processed normally

#### Scenario: All messages fail
- **WHEN** every message in a scan batch fails its rspamd check
- **THEN** none SHALL be included in the batch's processed results, and the batch failure SHALL be handled per the transient/permanent classification below

### Requirement: Per-message failure isolation during training
When training rspamd with a batch of messages from a training folder, a failure for one message SHALL NOT prevent the other messages in the batch from being learned and moved to their destination folder. A message that permanently fails to learn SHALL still be moved to its destination folder, unlearned, rather than left in the training folder — a training folder must not accumulate messages that can never succeed and would otherwise be retried, and re-logged, forever.

#### Scenario: One message fails to train, others succeed
- **WHEN** a training batch contains multiple messages and learning fails for exactly one of them
- **THEN** the other messages in the batch SHALL still be learned and moved to the destination folder

#### Scenario: A message permanently fails to learn
- **WHEN** a message's rspamd learn call fails with a permanent-for-this-message error
- **THEN** that message SHALL still be moved to the destination folder (unlearned), alongside the batch's successfully learned messages, and SHALL NOT be left behind in the training folder

### Requirement: Transient vs. permanent error classification
The system SHALL classify each per-message processing failure as either transient (no HTTP status, a network-level error, a request timeout, or an HTTP 5xx response) or permanent-for-this-message (an HTTP 4xx response, or a failure to parse the response into the expected result shape).

#### Scenario: Transient failure fails the batch as a whole
- **WHEN** a message's rspamd check or learn call fails with a transient error
- **THEN** the batch SHALL be treated as failed as a whole (none of its messages are treated as processed/learned), distinct from a permanent per-message failure

#### Scenario: Permanent failure skips only that message
- **WHEN** a message's rspamd check or learn call fails with a permanent-for-this-message error
- **THEN** that message SHALL be excluded from the batch's successful results, a `warn`-level log entry SHALL be recorded for it, and the batch SHALL otherwise complete successfully

### Requirement: Scanning escalates a transient batch failure; training never does
Scanning is the system's core function, so a transient batch failure there SHALL propagate as a rejected step, letting the orchestrator's existing step-retry-with-backoff and `MAX_RETRIES`/exit behavior act as the systemic-health signal. Training is secondary and best-effort: a transient batch failure, or any other error raised while opening or reading a training folder, SHALL be logged at `error` and SHALL NOT reject the training step - the orchestrator cycle continues normally with the remaining steps, and the untouched batch is retried on the next cycle.

#### Scenario: Transient scan failure propagates
- **WHEN** `processWithRspamd` rejects for a scan batch due to a transient error
- **THEN** `runScan` SHALL reject, so the orchestrator's cycle-level catch, backoff-retry, and `MAX_RETRIES`/`process.exit` handling apply exactly as they do for any other step failure

#### Scenario: Transient training failure does not propagate
- **WHEN** `trainSpam` or `trainHam` rejects for a training batch due to a transient error
- **THEN** `runTraining` SHALL catch it, log it at `error`, and resolve normally without moving any messages for that batch, and the orchestrator cycle SHALL continue with its remaining steps

#### Scenario: A non-rspamd error in training does not propagate either
- **WHEN** opening the training folder or fetching its messages fails (e.g. an IMAP connection error) before any batch is processed
- **THEN** `runTraining` SHALL catch it, log it at `error`, and resolve normally rather than rejecting

### Requirement: Scan progress advances past a permanently-skipped message
When a scan batch completes with one or more messages permanently skipped due to a per-message error, the scanner's `last_uid` progress SHALL still advance to include the skipped message's UID, so it is not retried indefinitely on every future scan cycle.

#### Scenario: Skipped message is the highest UID in the batch
- **WHEN** the highest-UID message in a scan batch is permanently skipped due to a per-message error
- **THEN** the scanner state's `last_uid` written after the batch SHALL still include that message's UID
