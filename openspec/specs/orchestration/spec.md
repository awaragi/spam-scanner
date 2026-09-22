# orchestration Specification

## Purpose

Drives the scanner's repeating cycle of training and scanning steps against isolated IMAP connections, in single-run, poll, or IDLE mode, retrying transient cycle failures with backoff and shutting down gracefully on SIGTERM/SIGINT.

## Requirements

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

#### Scenario: An unhandled step error aborts only the current cycle
- **WHEN** a step throws an unhandled error (in practice, only scanning/IDLE still do — training is best-effort and does not rethrow, per the `batch-processing-resilience` capability)
- **THEN** the remaining steps in that cycle SHALL NOT execute, but the orchestrator SHALL NOT exit immediately — the failure is instead handled by the cycle-retry-with-backoff requirement below

### Requirement: Configurable sleep interval
The orchestrator SHALL use `SCAN_INTERVAL` to control loop behaviour, defaulting to `0`.

#### Scenario: IDLE mode (default)
- **WHEN** `SCAN_INTERVAL` is `0` or not set in the environment
- **THEN** the orchestrator SHALL enter IDLE mode and SHALL NOT use a fixed sleep interval between cycles

#### Scenario: Custom interval used when set
- **WHEN** `SCAN_INTERVAL` is set to a positive integer in the environment
- **THEN** the orchestrator SHALL wait that many seconds after each completed cycle before starting the next, repeating indefinitely

#### Scenario: Single-run mode when SCAN_INTERVAL is negative
- **WHEN** `SCAN_INTERVAL` is set to `-1` in the environment
- **THEN** the orchestrator SHALL execute one full cycle and exit

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

### Requirement: Cycle failure retry with backoff
When any step in a cycle throws an unhandled error (train steps are best-effort per `batch-processing-resilience` and rarely do; in practice this is scan or IDLE), the orchestrator SHALL retry the cycle with exponential backoff rather than exiting immediately, up to `MAX_RETRIES` consecutive failures.

#### Scenario: Retry on cycle failure
- **WHEN** a cycle step throws an unhandled error
- **THEN** the orchestrator SHALL wait with exponential backoff (`min(2^n * 1000ms, 60000ms)`, where `n` is the consecutive failure count) and start a new cycle

#### Scenario: Fatal exit when retries exhausted
- **WHEN** the number of consecutive cycle failures reaches `MAX_RETRIES`
- **THEN** the orchestrator SHALL log an error and exit with a non-zero status code

#### Scenario: Failure counter resets on success
- **WHEN** a cycle completes successfully
- **THEN** the consecutive failure counter SHALL be reset to zero

#### Scenario: Default retry limit
- **WHEN** `MAX_RETRIES` is not set in the environment
- **THEN** the orchestrator SHALL default to `5` maximum consecutive failures

### Requirement: Graceful shutdown on SIGTERM/SIGINT
On receiving `SIGTERM` or `SIGINT`, the orchestrator SHALL finish the in-flight step and exit cleanly rather than being killed mid-write, and SHALL NOT start any further step.

#### Scenario: In-flight step is allowed to finish
- **WHEN** `SIGTERM` or `SIGINT` is received while a step is executing
- **THEN** that step SHALL be allowed to complete before the orchestrator exits

#### Scenario: No further steps start after a shutdown request
- **WHEN** a shutdown has been requested
- **THEN** the orchestrator SHALL NOT begin the next step in the current cycle, the next cycle, or a new IDLE wait

#### Scenario: An interruptible wait resolves immediately on shutdown
- **WHEN** a shutdown is requested while the orchestrator is sleeping between poll cycles, backing off after a failure, or waiting in IDLE
- **THEN** that wait SHALL resolve immediately instead of running to its full duration

#### Scenario: Duplicate signals are ignored
- **WHEN** a second `SIGTERM`/`SIGINT` is received after shutdown has already been requested
- **THEN** the orchestrator SHALL NOT re-trigger shutdown handling

### Requirement: Step execution timing
The orchestrator SHALL log the elapsed time for each step upon completion.

#### Scenario: Timing logged after each step
- **WHEN** a step completes (successfully or after error cleanup)
- **THEN** the orchestrator SHALL log the step name (`step`) and elapsed duration in milliseconds (`duration`) at `info` level
