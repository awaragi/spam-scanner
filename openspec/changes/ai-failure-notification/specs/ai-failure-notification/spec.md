# Spec Delta

## Purpose

Alerts the mailbox owner, via a message posted to their own INBOX, when AI classification has been failing repeatedly for the same underlying reason, without repeating the alert while that same issue is still ongoing.

## ADDED Requirements

### Requirement: Consecutive same-reason failure threshold
The system SHALL count consecutive AI classification failures that share the same normalized failure reason, and SHALL post an alert message to `INBOX` when that count reaches `AI_FAILURE_ALERT_THRESHOLD`.

#### Scenario: Threshold reached
- **WHEN** AI classification fails `AI_FAILURE_ALERT_THRESHOLD` times in a row with the same normalized failure reason, and no alert has been posted for the current run of failures
- **THEN** the system SHALL post an alert message to `INBOX`

#### Scenario: Below threshold
- **WHEN** AI classification has failed with the same normalized reason fewer than `AI_FAILURE_ALERT_THRESHOLD` times in a row
- **THEN** the system SHALL NOT post an alert message

### Requirement: Reason normalization
The system SHALL group AI classification failures by a normalized reason category (for example: network error, timeout, authentication failure, rate limit, provider server error, empty response, malformed response) rather than by the raw, per-failure error text, so that repeated failures of the same underlying cause are recognized as the same reason even when the raw error text varies between occurrences.

#### Scenario: Same underlying cause, different raw error text
- **WHEN** two consecutive AI classification failures are caused by the same underlying condition (for example, the AI provider returning unparsable output twice, with different unparsable content each time) but their raw error text differs
- **THEN** the system SHALL treat them as the same failure reason for threshold counting

### Requirement: A different failure reason starts a new count
The system SHALL restart the consecutive-failure count at one when a failure's normalized reason differs from the reason currently being counted, discarding the prior count.

#### Scenario: Reason changes before threshold is reached
- **WHEN** AI classification fails with reason A, then fails with reason B, and reason A's count had not yet reached `AI_FAILURE_ALERT_THRESHOLD`
- **THEN** the count for reason B SHALL start at one and reason A's prior count SHALL NOT contribute to it

### Requirement: A success resets the count
The system SHALL reset the consecutive-failure count to zero, and SHALL allow a future alert to be posted again, as soon as one AI classification succeeds.

#### Scenario: Recovery after failures below threshold
- **WHEN** AI classification fails one or more times (fewer than `AI_FAILURE_ALERT_THRESHOLD`) and then succeeds
- **THEN** the consecutive-failure count SHALL reset to zero

#### Scenario: Recovery after an alert was already posted
- **WHEN** an alert has been posted for the current run of same-reason failures, and AI classification subsequently succeeds
- **THEN** the count SHALL reset to zero, and a later run of `AI_FAILURE_ALERT_THRESHOLD` consecutive same-reason failures SHALL be able to post a new alert

### Requirement: No duplicate alerts for an ongoing issue
The system SHALL NOT post more than one alert for the same uninterrupted run of same-reason consecutive failures.

#### Scenario: Failures continue past the threshold
- **WHEN** AI classification keeps failing with the same reason after an alert has already been posted for that run of failures
- **THEN** the system SHALL NOT post another alert until a success occurs

### Requirement: Threshold is configurable and can be disabled
The system SHALL read the consecutive-failure threshold from `AI_FAILURE_ALERT_THRESHOLD`, defaulting to `3` when unset. The system SHALL NOT track failures or post alerts when `AI_FAILURE_ALERT_THRESHOLD` is `-1`.

#### Scenario: Default threshold
- **WHEN** `AI_FAILURE_ALERT_THRESHOLD` is not set
- **THEN** the system SHALL post an alert after 3 consecutive same-reason failures

#### Scenario: Feature disabled
- **WHEN** `AI_FAILURE_ALERT_THRESHOLD` is `-1`
- **THEN** the system SHALL NOT post an alert regardless of how many AI classification failures occur

### Requirement: Alert content
The alert message posted to `INBOX` SHALL identify the normalized failure reason, the number of consecutive failures observed, and the timestamp of the most recent failure.

#### Scenario: Alert is posted
- **WHEN** the system posts an alert message
- **THEN** the message SHALL be added to `INBOX` and SHALL contain the normalized failure reason, the consecutive failure count, and the timestamp of the most recent failure

### Requirement: No tracking when AI classification is disabled
The system SHALL NOT track failures or post alerts when `AI_ENABLED` is `false`.

#### Scenario: AI disabled
- **WHEN** `AI_ENABLED` is `false`
- **THEN** the system SHALL NOT post any AI failure alert, regardless of `AI_FAILURE_ALERT_THRESHOLD`
