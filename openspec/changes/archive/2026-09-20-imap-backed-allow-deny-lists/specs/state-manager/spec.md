# Spec Delta

## ADDED Requirements

### Requirement: Map/list state supports read, symmetric with write

The system SHALL provide a way to read back previously written map/list state (whitelist and blacklist), selecting the message with the highest IMAP UID when more than one match exists for the same state key — the same selection rule already required for scanner state.

#### Scenario: Reading a previously written list

- **WHEN** map/list state was written for a given state key and is later read
- **THEN** the system SHALL return the content of the most recently written message for that key

#### Scenario: Multiple list state messages present

- **WHEN** the state folder contains more than one message matching the requested list state key (for example, after an interruption between append and delete)
- **THEN** the system SHALL read and return the state from the message with the highest UID among the matches

### Requirement: Missing or unparseable map/list state defaults to empty, not an error

When no map/list state message exists yet for a given state key, or the message that does exist cannot be parsed as the expected format, reading that state SHALL return an empty result rather than throwing an error.

#### Scenario: Reading list state before anything has been trained

- **WHEN** no message matching a given list state key exists in the state folder
- **THEN** reading that state SHALL return an empty list/set rather than raising an error

#### Scenario: Reading a state message in an unrecognized format

- **WHEN** a message matching a given list state key exists but its body cannot be parsed as the expected format
- **THEN** reading that state SHALL return an empty result rather than raising an error or throwing a parse exception
