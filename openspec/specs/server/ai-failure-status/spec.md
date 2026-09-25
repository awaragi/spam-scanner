# server/ai-failure-status Specification

## Purpose
Governs how the server reports the shared AI provider's ongoing failure
state, since AI classification is shared across every mailbox rather than
belonging to any one of them: failures are tracked once, globally, and
surfaced as status rather than as a per-mailbox alert.

## Requirements

### Requirement: AI classification failures are tracked once, globally, not per mailbox
The server SHALL count consecutive AI classification failures that share
the same normalized failure reason across all mailboxes combined, not
separately per mailbox, since every mailbox shares the same AI provider.

#### Scenario: Failures across two mailboxes accumulate together
- **WHEN** one mailbox's AI classification call fails, and then a different
  mailbox's AI classification call fails with the same normalized reason
- **THEN** the consecutive-failure count for that reason reflects both
  failures combined, not two separate counts of one each

### Requirement: The current AI failure state is exposed as status, not sent as an alert
The server SHALL make available the AI provider's current normalized
failure reason (if any), its consecutive-failure count, and when it last
failed. The server SHALL NOT send an email or other notification message
about AI classification failures to any mailbox.

#### Scenario: A sustained AI outage is visible in status
- **WHEN** AI classification has failed several consecutive times for the
  same normalized reason
- **THEN** that reason and count are available from the server's exposed
  status, and no message has been sent to any mailbox about it

#### Scenario: A success clears the failure state
- **WHEN** an AI classification call succeeds after a run of consecutive
  failures
- **THEN** the exposed status no longer reports a consecutive failure count
  for the reason that had been failing
