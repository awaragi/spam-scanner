## ADDED Requirements

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

### Requirement: Map and state backup detail logs are at `.debug`
The system SHALL log map state backup operations and internal map-service calls at `.debug`. Final map update confirmations (actual file writes) SHALL remain at `.info`.

#### Scenario: Map backup detail
- **WHEN** a map workflow updates a map file and backs up state
- **THEN** "Map state backup updated", "Training messages moved", "Map file not found for state backup" SHALL be emitted at `.debug`
- **THEN** "${type} map updated" SHALL be emitted at `.info`

#### Scenario: Map service internal call
- **WHEN** `updateMapFile` is called from map-service
- **THEN** the "Map file updated" log in map-service.js SHALL be emitted at `.debug` (the definitive log is in rspamd-maps.js at `.info`)

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
