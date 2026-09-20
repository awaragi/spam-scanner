# Spec Delta

## ADDED Requirements

### Requirement: Blacklist check precedes the rspamd call

For each message in a scan batch, the scan workflow SHALL check the sender address against the mailbox's blacklist (per the `sender-lists` capability) before calling rspamd. A match SHALL classify the message as `confirmed` and exclude it from both the rspamd call and AI classification.

#### Scenario: Blacklisted sender skips rspamd and AI

- **WHEN** a message's sender address matches the mailbox's blacklist
- **THEN** the message SHALL be classified `confirmed` without being submitted to rspamd or to AI classification

#### Scenario: Non-blacklisted sender proceeds to rspamd

- **WHEN** a message's sender address does not match the blacklist
- **THEN** the message SHALL be checked with rspamd as normal

### Requirement: Four-tier, threshold-driven categorization

For each rspamd-scored message not already classified `confirmed` by a blacklist match, the scan workflow SHALL compute `percentage = (adjustedScore / required_score) * 100` — where `adjustedScore` is rspamd's returned score, minus 20 if the sender matches the mailbox's whitelist — and classify the message into exactly one of four tiers using three configurable thresholds, `SPAM_CLEAN_THRESHOLD` (default `30`), `SPAM_LOW_THRESHOLD` (default `60`), and `SPAM_CONFIRMED_THRESHOLD` (default `200`):

- `clean`: `percentage <= SPAM_CLEAN_THRESHOLD`
- `low`: `SPAM_CLEAN_THRESHOLD < percentage <= SPAM_LOW_THRESHOLD`
- `high`: `SPAM_LOW_THRESHOLD < percentage < SPAM_CONFIRMED_THRESHOLD`
- `confirmed`: `percentage >= SPAM_CONFIRMED_THRESHOLD`

When `required_score` is `0` or unavailable, `percentage` SHALL be treated as undefined and the message SHALL be classified `clean`.

#### Scenario: Clean message

- **WHEN** a message's percentage is less than or equal to `SPAM_CLEAN_THRESHOLD`
- **THEN** the message SHALL be classified `clean`

#### Scenario: Low-probability message

- **WHEN** a message's percentage is greater than `SPAM_CLEAN_THRESHOLD` and less than or equal to `SPAM_LOW_THRESHOLD`
- **THEN** the message SHALL be classified `low`

#### Scenario: High-probability message

- **WHEN** a message's percentage is greater than `SPAM_LOW_THRESHOLD` and less than `SPAM_CONFIRMED_THRESHOLD`
- **THEN** the message SHALL be classified `high`

#### Scenario: Confirmed by score alone

- **WHEN** a message's percentage is greater than or equal to `SPAM_CONFIRMED_THRESHOLD`
- **THEN** the message SHALL be classified `confirmed`, whether or not its sender is whitelisted

#### Scenario: Undefined percentage defaults to clean

- **WHEN** `required_score` is `0` or not present in rspamd's response
- **THEN** the message SHALL be classified `clean`

#### Scenario: Thresholds are configurable

- **WHEN** `SPAM_CLEAN_THRESHOLD`, `SPAM_LOW_THRESHOLD`, or `SPAM_CONFIRMED_THRESHOLD` are set via environment variables
- **THEN** categorization SHALL use those values instead of the defaults

### Requirement: Only clean and low tiers are eligible for AI escalation

The scan workflow SHALL submit only `clean`- and `low`-tier messages to AI classification. `high`- and `confirmed`-tier messages SHALL NOT be submitted to AI classification, and AI classification SHALL NOT be able to change a message's tier to `confirmed`. A whitelisted sender's `clean`- or `low`-tier message SHALL also be excluded from AI classification, per the `sender-lists` capability - but unlike `high`/`confirmed` exclusion, this SHALL NOT change which tier the message is classified into: it keeps the `clean` or `low` tier its (whitelist-adjusted) score actually produced, it is simply never sent to AI for possible escalation within that.

#### Scenario: High and confirmed tiers bypass AI

- **WHEN** a message is classified `high` or `confirmed`
- **THEN** it SHALL NOT be submitted to AI classification

#### Scenario: AI can escalate within clean/low/high but never to confirmed

- **WHEN** AI classification runs on a `clean`- or `low`-tier message
- **THEN** its resulting tier MAY be escalated up to `high`, but SHALL NOT become `confirmed`

#### Scenario: A whitelisted clean/low message skips AI but keeps its tier

- **WHEN** a message from a whitelisted sender is classified `clean` or `low`
- **THEN** it SHALL NOT be submitted to AI classification, and it SHALL remain classified in whichever of `clean` or `low` its score actually produced - it SHALL NOT be reclassified as `clean` if its tier was `low`

#### Scenario: A non-whitelisted clean/low message in the same batch is still sent to AI

- **WHEN** a scan batch contains both whitelisted and non-whitelisted `clean`/`low`-tier messages
- **THEN** only the non-whitelisted ones SHALL be submitted to AI classification

### Requirement: Confirmed-tier disposition

Messages classified `confirmed` — whether by blacklist match or by score — SHALL be moved to `FOLDER_SPAM`, the same disposition previously reserved for rspamd's own `reject` action.

#### Scenario: Confirmed message is moved to the spam folder

- **WHEN** a message is classified `confirmed`
- **THEN** it SHALL be moved to `FOLDER_SPAM`
