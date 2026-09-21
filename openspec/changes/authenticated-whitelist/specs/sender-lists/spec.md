# Spec Delta

## MODIFIED Requirements

### Requirement: Whitelist membership adjusts rspamd's score rather than overriding classification

When an incoming message's sender address matches an entry in the mailbox's whitelist, the system SHALL determine whether the sender is authenticated by checking rspamd's `/checkv2` response for a passing DKIM or DMARC symbol (`R_DKIM_ALLOW`, or `DMARC_POLICY_ALLOW`; `DMARC_POLICY_ALLOW_WITH_FAILURES` does NOT count as authenticated, since that symbol means the DMARC policy allowed the message despite a DKIM/SPF failure, not that it verified). The system SHALL subtract **20** from rspamd's returned score before the message is categorized when the sender is authenticated, or subtract **5** when the sender matches the whitelist but is not authenticated - in either case this is a score adjustment the message's content can still override, rather than a fixed disposition independent of that score.

#### Scenario: Whitelisted sender gets a score discount, not immunity

- **WHEN** a message's sender address matches a whitelist entry and rspamd's response includes a passing DKIM or DMARC symbol
- **THEN** the system SHALL use `score - 20` for categorization instead of the raw rspamd score

#### Scenario: Unauthenticated whitelisted sender gets a reduced score discount

- **WHEN** a message's sender address matches a whitelist entry but rspamd's response includes no passing DKIM or DMARC symbol for it
- **THEN** the system SHALL use `score - 5` for categorization instead of the raw rspamd score

#### Scenario: DMARC pass with underlying failures does not count as authenticated

- **WHEN** a message's sender address matches a whitelist entry and rspamd's response includes `DMARC_POLICY_ALLOW_WITH_FAILURES` but no `R_DKIM_ALLOW` or `DMARC_POLICY_ALLOW`
- **THEN** the system SHALL treat the sender as unauthenticated and use `score - 5` for categorization

#### Scenario: Severe content still overrides a whitelist match

- **WHEN** a whitelisted sender's message content is severe enough that its whitelist-adjusted score still meets the `confirmed` threshold
- **THEN** the message SHALL still be classified as `confirmed`, notwithstanding the whitelist match or its authentication status

#### Scenario: A whitelisted sender's message keeps its actual tier, not a blanket "clean"

- **WHEN** a whitelisted sender's message content is elevated enough that its whitelist-adjusted score lands in the `high` tier (below `confirmed`)
- **THEN** the message SHALL be classified `high` - the same disposition (e.g. `Spam:High` label or `FOLDER_SPAM_HIGH`) any other `high`-tier message receives - and SHALL NOT be silently treated as `clean` merely because its sender is whitelisted
