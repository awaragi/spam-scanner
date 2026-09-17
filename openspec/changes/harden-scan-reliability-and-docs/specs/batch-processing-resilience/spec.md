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
When training rspamd with a batch of messages from a training folder, a failure for one message SHALL NOT prevent the other messages in the batch from being learned and moved to their destination folder.

#### Scenario: One message fails to train, others succeed
- **WHEN** a training batch contains multiple messages and learning fails for exactly one of them
- **THEN** the other messages in the batch SHALL still be learned and moved to the destination folder, and the failing message SHALL remain in the training folder

### Requirement: Transient vs. permanent error classification
The system SHALL classify each per-message processing failure as either transient (no HTTP status, a network-level error, a request timeout, or an HTTP 5xx response) or permanent-for-this-message (an HTTP 4xx response, or a failure to parse the response into the expected result shape).

#### Scenario: Transient failure fails the batch for retry
- **WHEN** a message's rspamd check or learn call fails with a transient error
- **THEN** the batch SHALL be treated as failed as a whole, so the orchestrator's existing step-retry behavior retries it

#### Scenario: Permanent failure skips only that message
- **WHEN** a message's rspamd check or learn call fails with a permanent-for-this-message error
- **THEN** that message SHALL be excluded from the batch's successful results, a `warn`-level log entry SHALL be recorded for it, and the batch SHALL otherwise complete successfully

### Requirement: Scan progress advances past a permanently-skipped message
When a scan batch completes with one or more messages permanently skipped due to a per-message error, the scanner's `last_uid` progress SHALL still advance to include the skipped message's UID, so it is not retried indefinitely on every future scan cycle.

#### Scenario: Skipped message is the highest UID in the batch
- **WHEN** the highest-UID message in a scan batch is permanently skipped due to a per-message error
- **THEN** the scanner state's `last_uid` written after the batch SHALL still include that message's UID
