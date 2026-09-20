# logging-levels Specification

## Purpose

Governs how the system logs: a centralized, structured Pino logger configurable via environment variables (level, output format, component filtering), with per-component and per-message child loggers for correlation, secrets always redacted, and log-level choices tuned so `.info` carries only cycle/workflow summaries while per-message and driver-level detail stays at `.debug`.

## Requirements

### Requirement: Log level is configurable via LOG_LEVEL
The system SHALL read the minimum log level from `LOG_LEVEL`, accepting `trace`, `debug`, `info`, `warn`, `error`, or `fatal` (case-insensitive), defaulting to `info` when unset or invalid. An invalid value SHALL be reported via `console.warn` at startup rather than silently accepted.

#### Scenario: Valid level is applied
- **WHEN** `LOG_LEVEL=debug` is set
- **THEN** log lines below `debug` (i.e. `trace`) SHALL be suppressed, and `debug` and above SHALL be emitted

#### Scenario: Unset defaults to info
- **WHEN** `LOG_LEVEL` is not set
- **THEN** the effective level SHALL be `info`

#### Scenario: Invalid value falls back to info with a warning
- **WHEN** `LOG_LEVEL` is set to a value outside the accepted list
- **THEN** the system SHALL emit a startup warning naming the invalid value and fall back to `info`

### Requirement: Output format is configurable via LOG_FORMAT
The system SHALL read the output format from `LOG_FORMAT`, accepting `json`, `jsonl`, or `pretty` (case-insensitive), defaulting to `json` when unset or invalid. `pretty` requires the optional `pino-pretty` dependency, which is not installed in the production Docker image.

#### Scenario: Default is JSON
- **WHEN** `LOG_FORMAT` is not set
- **THEN** log lines SHALL be emitted as JSON

#### Scenario: Invalid value falls back to json with a warning
- **WHEN** `LOG_FORMAT` is set to a value outside the accepted list
- **THEN** the system SHALL emit a startup warning naming the invalid value and fall back to `json`

### Requirement: Component and per-message logging is filterable via LOG_FILTER_INCLUDES/EXCLUDES
The system SHALL support restricting emitted logs to a comma-separated allowlist of component names via `LOG_FILTER_INCLUDES`, and/or excluding a comma-separated denylist via `LOG_FILTER_EXCLUDES`. When both are set, a component SHALL be logged only if it is in the includes list and not in the excludes list.

#### Scenario: Includes list restricts output
- **WHEN** `LOG_FILTER_INCLUDES=scan-workflow` is set
- **THEN** only log lines from the `scan-workflow` component SHALL be emitted

#### Scenario: Excludes list suppresses output
- **WHEN** `LOG_FILTER_EXCLUDES=imap-client` is set
- **THEN** log lines from the `imap-client` component SHALL be suppressed while all other components are still emitted

### Requirement: Secrets are always redacted regardless of level or format
The system SHALL redact `IMAP_PASSWORD`, `RSPAMD_PASSWORD`, and `AI_API_KEY` (at both the top level and one level of nesting, e.g. under a `headers` object) from every log line, including at `LOG_LEVEL=debug`.

#### Scenario: Secret value never reaches log output
- **WHEN** a log call's merging object contains `IMAP_PASSWORD`, `RSPAMD_PASSWORD`, or `AI_API_KEY`
- **THEN** the emitted log line SHALL contain a redaction placeholder instead of the real value, at every configured log level

### Requirement: Component and per-message child loggers for correlation
The system SHALL provide a component-scoped child logger (identifying which module emitted a line) and a per-message child logger (attaching the message UID) so related log lines can be correlated without repeating that context on every call.

#### Scenario: Component logger tags every line from that module
- **WHEN** a module creates a logger via the component-logger helper
- **THEN** every log line from that logger SHALL include the component's name

#### Scenario: Per-message logger tags every line for that message
- **WHEN** a workflow creates a per-message logger for a given UID
- **THEN** every log line from that logger SHALL include that UID, so all lines for one message can be correlated

### Requirement: Idle cycle produces no `.info` output
In continuous operation, when a workflow cycle finds zero messages to process, the system SHALL NOT emit any `.info` log lines during that cycle.

#### Scenario: Scan workflow idle
- **WHEN** the scan workflow runs and finds no new messages in the inbox
- **THEN** no `.info` log is emitted (the "No new messages to process" event SHALL log at `.debug`)

#### Scenario: Train workflow idle
- **WHEN** a training workflow runs and the training folder contains zero messages
- **THEN** no `.info` log is emitted (the "No messages in folder to process" event SHALL log at `.debug`)

#### Scenario: Map workflow idle
- **WHEN** a map workflow runs and the training folder contains zero messages
- **THEN** no `.info` log is emitted (the "No messages in training folder" event SHALL log at `.debug`)

---

### Requirement: Per-message intermediate logs are at `.debug`
The system SHALL log per-message processing steps (Rspamd check start, Rspamd check result, Rspamd scan results, rspamd learn start, rspamd learn result) at `.debug` level, not `.info`.

#### Scenario: Rspamd check logs
- **WHEN** a message is checked with Rspamd
- **THEN** "Starting Rspamd check", "Rspamd check completed", and "Rspamd scan results" SHALL be emitted at `.debug`

#### Scenario: Rspamd learn logs
- **WHEN** a message is submitted to Rspamd for learning (spam or ham)
- **THEN** "Learning message with rspamd" and "Message processed with rspamd learn" SHALL be emitted at `.debug`

---

### Requirement: IMAP operation confirmations are at `.debug`
The system SHALL log IMAP driver-level operation confirmations (folder opened, search issued, messages found/fetched, move confirmed, flags updated) at `.debug` level, with the exception of folder creation which SHALL remain at `.info`.

#### Scenario: Folder open confirmation
- **WHEN** a folder is successfully opened
- **THEN** the "Opened folder" event SHALL be emitted at `.debug`

#### Scenario: Search and fetch confirmations
- **WHEN** an IMAP search or message fetch completes
- **THEN** "Searching messages", "No messages found", "Found messages", "Fetched all messages", "Fetched messages by UIDs" SHALL be emitted at `.debug`

#### Scenario: Move and flag confirmations
- **WHEN** messages are moved or flags are updated
- **THEN** "All messages moved", "Flags added successfully", "Flags removed successfully", "All message flags updated", "Successfully moved message by UID", "Move completed with expunge" SHALL be emitted at `.debug`

#### Scenario: Folder creation stays at `.info`
- **WHEN** a new IMAP folder is created
- **THEN** "Created folder" SHALL be emitted at `.info`

---

### Requirement: Processor strategy and category detail logs are at `.debug`
The system SHALL log processor strategy selection and per-category action counts (resetting labels, applying Spam:Low, applying Spam:High, moving low/high spam) at `.debug`. Top-level workflow summaries SHALL remain at `.info`.

#### Scenario: Label processor detail
- **WHEN** the label processor runs
- **THEN** "Processing messages with label strategy", "Resetting spam labels on clean messages", "Applying Spam:Low label", "Applying Spam:High label" SHALL be emitted at `.debug`

#### Scenario: Folder processor detail
- **WHEN** the folder processor runs
- **THEN** "Processing messages with folder strategy", "Moving low spam messages", "Moving high spam messages" SHALL be emitted at `.debug`

---

### Requirement: Intra-batch progress logs are at `.debug`
The system SHALL log intermediate batch progress ("Scanning batch", "Learn batch", "Moving spam messages to spam folder") at `.debug`. End-of-workflow summaries with final counts SHALL remain at `.info`.

#### Scenario: Scan batch progress
- **WHEN** the scan workflow processes a batch of messages
- **THEN** individual "Scanning batch" and "Moving spam messages to spam folder" events SHALL be emitted at `.debug`
- **THEN** "Batch processing completed" and "All scan operations completed" SHALL be emitted at `.info`

#### Scenario: Training batch progress
- **WHEN** the training workflow processes a batch
- **THEN** "Learn batch" SHALL be emitted at `.debug`
- **THEN** "All operations completed" SHALL be emitted at `.info`

---

### Requirement: List training detail logs are at `.debug`; the list-updated summary stays at `.info`
The system SHALL log training-folder message-move confirmations and internal list-state write detail at `.debug`. The per-run summary of a whitelist/blacklist update (per the `sender-lists` capability) SHALL remain at `.info`.

#### Scenario: Training move detail
- **WHEN** a whitelist/blacklist training workflow moves processed messages to their destination folder
- **THEN** "Training messages moved" SHALL be emitted at `.debug`

#### Scenario: List update summary
- **WHEN** a whitelist/blacklist training workflow extracts one or more sender addresses and updates the mailbox's list state
- **THEN** "${type} list updated" SHALL be emitted at `.info`

#### Scenario: List service internal call
- **WHEN** `updateListState` writes a mailbox's whitelist or blacklist state (`map-service.js`)
- **THEN** "List state updated" SHALL be emitted at `.debug`

---

### Requirement: Rspamd learn-skipped and address rejection logs are at `.debug`
The system SHALL log "Rspamd learn ham/spam skipped" (already-learned messages) and "Email address rejected as non-human-readable" at `.debug`.

#### Scenario: Learn already known
- **WHEN** Rspamd reports a message was already learned
- **THEN** "Rspamd learn ham skipped" / "Rspamd learn spam skipped" SHALL be emitted at `.debug`

#### Scenario: Address rejection during map extraction
- **WHEN** an email address is rejected as non-human-readable during sender extraction
- **THEN** "Email address rejected as non-human-readable" SHALL be emitted at `.debug`

---

### Requirement: Startup config detail is at `.debug`
The system SHALL log "Processing mode is folder, including spam likelihood folders" in `init-folders.js` at `.debug`. Startup/completion markers SHALL remain at `.info`.

#### Scenario: Init folders mode config
- **WHEN** folder initialization runs with folder processing mode enabled
- **THEN** "Processing mode is folder, including spam likelihood folders" SHALL be emitted at `.debug`
- **THEN** "Starting folder initialization" and "Folder initialization completed" SHALL be emitted at `.info`
