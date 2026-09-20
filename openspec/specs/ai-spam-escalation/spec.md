# ai-spam-escalation Specification

## Purpose

Provides an optional AI-based safety net that re-reviews rspamd's non-confident buckets (`clean`/`low`) and may escalate a message toward a more severe tier, without ever downgrading a message or pushing one into the confirmed/spam tier itself.

## Requirements

### Requirement: AI review scope
The system SHALL send only messages in rspamd's `nonSpamMessages` and `lowSpamMessages` buckets to AI classification. Messages in `highSpamMessages` or `spamMessages` SHALL NOT be sent to the AI.

#### Scenario: Non-confident buckets are reviewed
- **WHEN** `AI_ENABLED` is `true` and a batch contains messages in `nonSpamMessages` and `lowSpamMessages`
- **THEN** each of those messages SHALL be classified by the AI

#### Scenario: Confident buckets are skipped
- **WHEN** `AI_ENABLED` is `true` and a batch contains messages in `highSpamMessages` or `spamMessages`
- **THEN** none of those messages SHALL be sent to the AI, and they SHALL pass through to the processor/move step unchanged

### Requirement: Escalate-only re-bucketing
The system SHALL only move a message to a bucket ranked more severe than the one rspamd originally assigned it (rank order: `nonSpam < lowSpam < highSpam < spam`). The system SHALL NOT de-escalate a message to a less severe bucket based on an AI result.

#### Scenario: nonSpam escalates to lowSpam
- **WHEN** a message in `nonSpamMessages` receives an AI score at or above `AI_ESCALATE_TO_LOW_THRESHOLD` but below `AI_ESCALATE_TO_HIGH_THRESHOLD`
- **THEN** the message SHALL be moved to `lowSpamMessages`

#### Scenario: nonSpam escalates to highSpam
- **WHEN** a message in `nonSpamMessages` receives an AI score at or above `AI_ESCALATE_TO_HIGH_THRESHOLD`
- **THEN** the message SHALL be moved to `highSpamMessages`

#### Scenario: lowSpam escalates to highSpam
- **WHEN** a message in `lowSpamMessages` receives an AI score at or above `AI_ESCALATE_TO_HIGH_THRESHOLD`
- **THEN** the message SHALL be moved to `highSpamMessages`

#### Scenario: No de-escalation on low AI score
- **WHEN** a message in `lowSpamMessages` receives an AI score below `AI_ESCALATE_TO_LOW_THRESHOLD`
- **THEN** the message SHALL remain in `lowSpamMessages` and SHALL NOT be moved to `nonSpamMessages`

### Requirement: Escalation capped below spam
The system SHALL NOT move a message into `spamMessages` as a result of AI classification, regardless of AI score. Only a blacklist match or rspamd/AI-driven score meeting the `confirmed` threshold SHALL determine membership in `spamMessages`.

#### Scenario: Maximum AI score does not reach spam
- **WHEN** a message in `nonSpamMessages` or `lowSpamMessages` receives the maximum possible AI score
- **THEN** the message SHALL be moved to `highSpamMessages` at most, and SHALL NOT appear in `spamMessages`

### Requirement: Fail-open on AI error
The system SHALL NOT abort batch processing when AI classification fails for one or more messages (timeout, network error, malformed response, or any other error). A message whose AI classification fails SHALL remain in its original rspamd bucket, and the error SHALL be logged.

#### Scenario: Single message AI failure does not affect the batch
- **WHEN** AI classification fails for one message in a batch of several `nonSpamMessages`/`lowSpamMessages`
- **THEN** the failing message SHALL remain in its original bucket, the other messages SHALL still be classified normally, and batch processing SHALL complete without throwing

#### Scenario: AI provider fully unreachable
- **WHEN** the configured AI provider is unreachable for an entire batch
- **THEN** every candidate message SHALL remain in its original rspamd bucket and the scan SHALL complete successfully

### Requirement: No-op when AI is disabled
The system SHALL skip AI classification and escalation entirely when `AI_ENABLED` is `false` (the default). The `nonSpamMessages`, `lowSpamMessages`, and `highSpamMessages` buckets handed to the processor SHALL be exactly rspamd's `categorizeMessages()` output.

#### Scenario: AI disabled
- **WHEN** `AI_ENABLED` is `false`
- **THEN** no AI classification calls SHALL be made, and `nonSpamMessages`/`lowSpamMessages`/`highSpamMessages`/`spamMessages` SHALL be exactly rspamd's `categorizeMessages()` output

### Requirement: Cache-friendly request shape
The system SHALL send all static instructional content (rubric, safety-net framing, optional user profile) in the chat completion's `system` message, computed once and reused unchanged across calls, and SHALL send only per-email variable content in the `user` message.

#### Scenario: System message is stable across calls
- **WHEN** two different messages are classified in the same process
- **THEN** the `system` message content sent to the AI provider SHALL be identical for both calls

#### Scenario: Per-email content is isolated to the user message
- **WHEN** a message is classified
- **THEN** the `system` message SHALL NOT contain any of that message's from/to/subject/body values
