## ADDED Requirements

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
The orchestrator SHALL wait `SCAN_INTERVAL` seconds (defaulting to 300) between poll cycles.

#### Scenario: Custom interval used when set
- **WHEN** `SCAN_INTERVAL` is set to a positive integer in the environment
- **THEN** the orchestrator SHALL wait that many seconds after each completed cycle before starting the next

#### Scenario: Default interval used when not set
- **WHEN** `SCAN_INTERVAL` is not set in the environment
- **THEN** the orchestrator SHALL wait 300 seconds between cycles
