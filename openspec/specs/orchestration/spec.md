### Requirement: Startup validation
The orchestrator SHALL validate that required environment variables (`IMAP_HOST`, `IMAP_USER`) are present at startup and exit with a non-zero status code if any are missing.

#### Scenario: Required variables present
- **WHEN** `IMAP_HOST` and `IMAP_USER` are set in the environment
- **THEN** the orchestrator SHALL proceed to the init phase

#### Scenario: IMAP_HOST missing
- **WHEN** `IMAP_HOST` is not set in the environment
- **THEN** the orchestrator SHALL log an error and exit with a non-zero status code

#### Scenario: IMAP_USER missing
- **WHEN** `IMAP_USER` is not set in the environment
- **THEN** the orchestrator SHALL log an error and exit with a non-zero status code

### Requirement: One-time init phase
The orchestrator SHALL run the init-folders step exactly once at startup, before entering the poll loop.

#### Scenario: Init runs before first poll cycle
- **WHEN** the orchestrator starts successfully
- **THEN** `runInit` from `init-workflow.js` SHALL be called before any training or scanning step

#### Scenario: Init not repeated on subsequent cycles
- **WHEN** the poll loop completes one cycle and begins the next
- **THEN** the init step SHALL NOT be called again

### Requirement: Step connection isolation
For each step execution, the orchestrator SHALL open a new IMAP connection, call the workflow function, and close the connection — regardless of whether the step succeeds or fails.

#### Scenario: Connection closed on success
- **WHEN** a workflow function completes successfully
- **THEN** the IMAP connection SHALL be closed before the next step begins

#### Scenario: Connection closed on error
- **WHEN** a workflow function throws an error
- **THEN** the IMAP connection SHALL still be closed before the error propagates

### Requirement: Poll loop step sequence
The orchestrator SHALL execute the following steps in order on each poll cycle: train-spam, train-ham, train-whitelist, train-blacklist, scan-inbox.

#### Scenario: Full cycle executes in sequence
- **WHEN** the poll loop begins a cycle
- **THEN** the steps SHALL execute in the order: `runSpam`, `runHam`, `runWhitelist`, `runBlacklist`, `run` (scan)

#### Scenario: Step failure halts the cycle
- **WHEN** a step throws an unhandled error
- **THEN** the remaining steps in that cycle SHALL NOT execute and the process SHALL exit

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

### Requirement: Step execution timing
The orchestrator SHALL log the elapsed time for each step upon completion.

#### Scenario: Timing logged after each step
- **WHEN** a step completes (successfully or after error cleanup)
- **THEN** the orchestrator SHALL log the step name (`step`) and elapsed duration in milliseconds (`duration`) at `info` level
