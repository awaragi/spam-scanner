### Requirement: UID result filter
The scan workflow SHALL filter the IMAP UID search results to exclude any UID that is less than or equal to `state.last_uid` before enqueuing messages for processing.

#### Scenario: No new messages — IMAP range inversion
- **WHEN** the mailbox contains no UIDs greater than `state.last_uid`
- **THEN** the IMAP search result SHALL be filtered to an empty list and no messages SHALL be processed

#### Scenario: New messages present
- **WHEN** the mailbox contains one or more UIDs greater than `state.last_uid`
- **THEN** only those UIDs SHALL be enqueued for scanning

#### Scenario: Mixed results including already-processed UID
- **WHEN** the IMAP search returns a list that includes UIDs ≤ `state.last_uid` alongside genuinely new UIDs
- **THEN** only UIDs strictly greater than `state.last_uid` SHALL be enqueued for scanning

### Requirement: Processed message count return value
The scan workflow `run()` function SHALL return the count of messages processed in the current invocation so callers can determine whether another scan pass is needed.

#### Scenario: Returns count when messages are processed
- **WHEN** `run()` processes one or more messages
- **THEN** it SHALL return `{ processed: N }` where N is the number of messages fetched and processed in that call

#### Scenario: Returns zero when no new messages
- **WHEN** `run()` finds no UIDs greater than `state.last_uid`
- **THEN** it SHALL return `{ processed: 0 }`
