## ADDED Requirements

### Requirement: AI review scope
The system SHALL send only messages in rspamd's `nonSpamMessages` and `lowSpamMessages` buckets to AI classification. Messages in `highSpamMessages`, `spamMessages`, or `whitelistedMessages` SHALL NOT be sent to the AI.

#### Scenario: Non-confident buckets are reviewed
- **WHEN** `AI_ENABLED` is `true` and a batch contains messages in `nonSpamMessages` and `lowSpamMessages`
- **THEN** each of those messages SHALL be classified by the AI

#### Scenario: Confident buckets are skipped
- **WHEN** `AI_ENABLED` is `true` and a batch contains messages in `highSpamMessages` or `spamMessages`
- **THEN** none of those messages SHALL be sent to the AI, and they SHALL pass through to the processor/move step unchanged

### Requirement: Whitelisted senders are categorized separately and never AI-reviewed
The system SHALL categorize a message into a distinct `whitelistedMessages` bucket, separate from `nonSpamMessages`/`lowSpamMessages`/`highSpamMessages`, when rspamd's response indicates the sender matched the whitelist (the `WHITELIST_EMAIL` symbol, as configured in `rspamd/config/multimap.conf`) and the message is not otherwise flagged as spam by rspamd's own "reject" verdict. Messages in `whitelistedMessages` SHALL NOT be sent to AI classification, and SHALL be included with `nonSpamMessages` for labeling/foldering purposes.

#### Scenario: Whitelisted, non-rejected message is categorized as whitelisted
- **WHEN** a message's `spamInfo.isWhitelisted` is `true` and `spamInfo.isSpam` is `false`
- **THEN** the message SHALL be placed in `whitelistedMessages`, not in `nonSpamMessages`, `lowSpamMessages`, or `highSpamMessages`

#### Scenario: rspamd's reject verdict overrides a whitelist match
- **WHEN** a message's `spamInfo.isWhitelisted` is `true` and `spamInfo.isSpam` is `true`
- **THEN** the message SHALL be placed in `spamMessages`, not in `whitelistedMessages`

#### Scenario: Whitelisted messages are excluded from the AI call
- **WHEN** `AI_ENABLED` is `true` and a batch contains messages in `whitelistedMessages`
- **THEN** none of those messages SHALL be sent to the AI provider

#### Scenario: Whitelisted messages are treated as clean mail for labeling/moving
- **WHEN** a batch containing `whitelistedMessages` completes processing
- **THEN** those messages SHALL be included alongside `nonSpamMessages` when the processor labels/folders messages, and SHALL NOT be moved to the spam folder

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
The system SHALL NOT move a message into `spamMessages` as a result of AI classification, regardless of AI score. Only rspamd's own "reject" verdict SHALL determine membership in `spamMessages`.

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
The system SHALL skip AI classification and escalation entirely when `AI_ENABLED` is `false` (the default). The `nonSpamMessages`, `lowSpamMessages`, and `highSpamMessages` buckets handed to the processor SHALL be exactly rspamd's `categorizeMessages()` output, except that `whitelistedMessages` is always merged into `nonSpamMessages` (this merge is unconditional and not part of the AI feature's on/off behavior).

#### Scenario: AI disabled
- **WHEN** `AI_ENABLED` is `false`
- **THEN** no AI classification calls SHALL be made, `lowSpamMessages`/`highSpamMessages`/`spamMessages` SHALL be exactly rspamd's `categorizeMessages()` output, and `nonSpamMessages` SHALL be rspamd's `nonSpamMessages` plus `whitelistedMessages`

### Requirement: Cache-friendly request shape
The system SHALL send all static instructional content (rubric, safety-net framing, optional user profile) in the chat completion's `system` message, computed once and reused unchanged across calls, and SHALL send only per-email variable content in the `user` message.

#### Scenario: System message is stable across calls
- **WHEN** two different messages are classified in the same process
- **THEN** the `system` message content sent to the AI provider SHALL be identical for both calls

#### Scenario: Per-email content is isolated to the user message
- **WHEN** a message is classified
- **THEN** the `system` message SHALL NOT contain any of that message's from/to/subject/body values
