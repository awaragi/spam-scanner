# Spec Delta

## MODIFIED Requirements

### Requirement: Only clean and low tiers are eligible for AI escalation

The scan workflow SHALL submit only `clean`- and `low`-tier messages to AI classification. `high`- and `confirmed`-tier messages SHALL NOT be submitted to AI classification, and AI classification SHALL NOT be able to change a message's tier to `confirmed`. An authenticated whitelisted sender's `clean`- or `low`-tier message SHALL also be excluded from AI classification, per the `sender-lists` capability - but unlike `high`/`confirmed` exclusion, this SHALL NOT change which tier the message is classified into: it keeps the `clean` or `low` tier its (whitelist-adjusted) score actually produced, it is simply never sent to AI for possible escalation within that. An **unauthenticated** whitelisted sender's `clean`- or `low`-tier message SHALL NOT be excluded from AI classification on the basis of the whitelist match alone - it SHALL be submitted to AI the same as a non-whitelisted message, since an unauthenticated match does not establish that the sender is who the whitelist entry names.

#### Scenario: High and confirmed tiers bypass AI

- **WHEN** a message is classified `high` or `confirmed`
- **THEN** it SHALL NOT be submitted to AI classification

#### Scenario: AI can escalate within clean/low/high but never to confirmed

- **WHEN** AI classification runs on a `clean`- or `low`-tier message
- **THEN** its resulting tier MAY be escalated up to `high`, but SHALL NOT become `confirmed`

#### Scenario: A whitelisted clean/low message skips AI but keeps its tier

- **WHEN** a message from a whitelisted sender is classified `clean` or `low`, and rspamd's response includes a passing DKIM or DMARC symbol for that message
- **THEN** it SHALL NOT be submitted to AI classification, and it SHALL remain classified in whichever of `clean` or `low` its score actually produced - it SHALL NOT be reclassified as `clean` if its tier was `low`

#### Scenario: An unauthenticated whitelisted clean/low message is still sent to AI

- **WHEN** a message from a whitelisted sender is classified `clean` or `low`, but rspamd's response includes no passing DKIM or DMARC symbol for that message
- **THEN** it SHALL be submitted to AI classification the same as a non-whitelisted `clean`/`low` message

#### Scenario: A non-whitelisted clean/low message in the same batch is still sent to AI

- **WHEN** a scan batch contains both whitelisted and non-whitelisted `clean`/`low`-tier messages
- **THEN** only the non-whitelisted ones SHALL be submitted to AI classification
