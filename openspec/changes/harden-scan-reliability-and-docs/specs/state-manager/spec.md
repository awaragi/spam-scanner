# Spec Delta

## Purpose

Guarantees that the scanner's and maps' state, stored as messages in the mailbox's state folder, is never lost or made unreadable by a failed or interrupted write, and that a missing state is initialized safely and predictably - defaulting to new-mail-only, but configurable to a full-inbox scan when that's what the operator wants - rather than accidentally triggering an unwanted full re-scan of the inbox.

## ADDED Requirements

### Requirement: Append before delete on state write
When writing scanner state or map state to the mailbox state folder, the system SHALL append the new state message before deleting any previous state message(s) for the same key, so at least one valid state message exists at every point in time, including if the write is interrupted after the append.

#### Scenario: Append succeeds, old message is removed
- **WHEN** `writeScannerState` (or `writeMapState`) is called and a previous state message for that key exists
- **THEN** the new state message SHALL be appended to the state folder first, and only after a successful append SHALL the previous state message(s) for that key be deleted

#### Scenario: Append fails
- **WHEN** appending the new state message fails (connection drop, quota exceeded, server error)
- **THEN** the previous state message SHALL NOT be deleted, and the state folder SHALL still contain a valid, readable state message for that key

#### Scenario: No previous state exists
- **WHEN** `writeScannerState` (or `writeMapState`) is called and no previous state message for that key exists
- **THEN** the new state message SHALL be appended and no delete SHALL be attempted

### Requirement: Read selects the newest state message
When reading scanner state or map state, if more than one message matches the state key, the system SHALL select the message with the highest IMAP UID (the most recently written one) rather than an arbitrary or lowest-UID match.

#### Scenario: Multiple state messages present
- **WHEN** the state folder contains more than one message matching the requested state key (for example, after an interruption between append and delete)
- **THEN** the system SHALL read and return the state from the message with the highest UID among the matches

#### Scenario: Single state message present
- **WHEN** the state folder contains exactly one message matching the requested state key
- **THEN** the system SHALL read and return the state from that message

### Requirement: Safe default when scanner state is missing, configurable via SCAN_INITIAL_STATE
When no scanner state message exists and the request supplies a default state, the system SHALL NOT unconditionally default `last_uid` to `0`. Instead, the initial `last_uid` SHALL be determined by the `SCAN_INITIAL_STATE` setting (`new` or `all`, defaulting to `new`) and, either way, a `warn`-level message SHALL be logged noting that a default state was used.
- `SCAN_INITIAL_STATE=new` (default): if the target mailbox is non-empty, `last_uid` SHALL be initialized to `UIDNEXT - 1` (so scanning begins with new mail only); if the mailbox is empty, `last_uid` SHALL be `0`.
- `SCAN_INITIAL_STATE=all`: `last_uid` SHALL always be initialized to `0`, regardless of the mailbox's contents, so the first scan covers the entire existing mailbox.

`SCAN_INITIAL_STATE` only affects this missing-state default; once a scanner state message exists, its `last_uid` is read and used as-is and this setting has no further effect.

#### Scenario: No state, SCAN_INITIAL_STATE=new (default), non-empty mailbox
- **WHEN** `readScannerState` finds no matching state message, `SCAN_INITIAL_STATE` is `new`, and the target mailbox's `UIDNEXT` is greater than `1`
- **THEN** the returned state's `last_uid` SHALL be `UIDNEXT - 1`, and a `warn`-level log entry SHALL be emitted noting a default state was used

#### Scenario: No state, SCAN_INITIAL_STATE=new (default), empty mailbox
- **WHEN** `readScannerState` finds no matching state message, `SCAN_INITIAL_STATE` is `new`, and the target mailbox is empty (`UIDNEXT` is `1`)
- **THEN** the returned state's `last_uid` SHALL be `0`

#### Scenario: No state, SCAN_INITIAL_STATE=all
- **WHEN** `readScannerState` finds no matching state message and `SCAN_INITIAL_STATE` is `all`
- **THEN** the returned state's `last_uid` SHALL be `0` regardless of the mailbox's `UIDNEXT`, and a `warn`-level log entry SHALL be emitted noting a default state was used

#### Scenario: Invalid SCAN_INITIAL_STATE value
- **WHEN** `SCAN_INITIAL_STATE` is set to a value other than `new` or `all`
- **THEN** the system SHALL fail fast at startup with a clear error, rather than silently falling back to a default
