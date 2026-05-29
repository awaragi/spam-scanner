## MODIFIED Requirements

### Requirement: Configurable sleep interval
The orchestrator SHALL use `SCAN_INTERVAL` to control loop behaviour, defaulting to `-1`.

#### Scenario: Single-run mode (default)
- **WHEN** `SCAN_INTERVAL` is `-1` or not set in the environment
- **THEN** the orchestrator SHALL execute one full cycle and exit

#### Scenario: Custom interval used when set
- **WHEN** `SCAN_INTERVAL` is set to a positive integer in the environment
- **THEN** the orchestrator SHALL wait that many seconds after each completed cycle before starting the next, repeating indefinitely

#### Scenario: IDLE mode when SCAN_INTERVAL is zero
- **WHEN** `SCAN_INTERVAL` is set to `0` in the environment
- **THEN** the orchestrator SHALL enter IDLE mode and SHALL NOT use a fixed sleep interval between cycles

## ADDED Requirements

### Requirement: IDLE mode loop
When `SCAN_INTERVAL=0`, the orchestrator SHALL drive scan cycles via IMAP IDLE notifications rather than a fixed sleep interval.

#### Scenario: Full cycle runs on IDLE wakeup
- **WHEN** the IMAP server sends an EXISTS notification during IDLE
- **THEN** the orchestrator SHALL close the IDLE connection and execute a full cycle (train-spam, train-ham, train-whitelist, train-blacklist, scan drain) before re-entering IDLE

#### Scenario: Re-enters IDLE after cycle completes
- **WHEN** the full cycle after an IDLE wakeup completes successfully
- **THEN** the orchestrator SHALL open a new IDLE connection and re-enter IDLE

### Requirement: IDLE scan drain loop
In IDLE mode, after an IDLE wakeup the orchestrator SHALL repeat the scan step until no new messages remain.

#### Scenario: Drain stops when scan finds no messages
- **WHEN** `runScan` returns `{ processed: 0 }`
- **THEN** the orchestrator SHALL stop the drain loop and re-enter IDLE

#### Scenario: Drain continues while messages are found
- **WHEN** `runScan` returns `{ processed: N }` where N > 0
- **THEN** the orchestrator SHALL call `runScan` again before re-entering IDLE

#### Scenario: Training runs once per wakeup, not per drain iteration
- **WHEN** an IDLE wakeup triggers a cycle
- **THEN** training steps SHALL run exactly once before the drain loop begins, regardless of how many drain iterations occur

### Requirement: IDLE reconnection with retry
In IDLE mode, the orchestrator SHALL attempt to reconnect if the IDLE connection fails, up to a configurable maximum.

#### Scenario: Retry on IDLE connection failure
- **WHEN** the IDLE connection throws an error
- **THEN** the orchestrator SHALL wait with exponential backoff (`min(2^n * 1000ms, 60000ms)`) and retry the IDLE cycle

#### Scenario: Fatal exit when retries exhausted
- **WHEN** the number of consecutive IDLE failures reaches `IDLE_MAX_RETRIES`
- **THEN** the orchestrator SHALL log a fatal error and exit with a non-zero status code

#### Scenario: Retry counter resets on success
- **WHEN** an IDLE cycle completes successfully (IDLE resolves and full step sequence runs without error)
- **THEN** the consecutive failure counter SHALL be reset to zero

#### Scenario: Default retry limit
- **WHEN** `IDLE_MAX_RETRIES` is not set in the environment
- **THEN** the orchestrator SHALL default to `5` maximum retries
