## ADDED Requirements

### Requirement: Processed message count return value
The scan workflow `run()` function SHALL return the count of messages processed in the current invocation so callers can determine whether another scan pass is needed.

#### Scenario: Returns count when messages are processed
- **WHEN** `run()` processes one or more messages
- **THEN** it SHALL return `{ processed: N }` where N is the number of messages fetched and processed in that call

#### Scenario: Returns zero when no new messages
- **WHEN** `run()` finds no UIDs greater than `state.last_uid`
- **THEN** it SHALL return `{ processed: 0 }`
