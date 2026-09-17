# Spec Delta

## Purpose

Ensures configured IMAP folder paths work correctly regardless of the mail server's actual hierarchy delimiter, by resolving them once against the server's real delimiter and using the resolved paths consistently everywhere a folder is opened, searched, appended to, or moved to.

## ADDED Requirements

### Requirement: Folder paths are resolved against the server's real delimiter
The system SHALL determine the IMAP server's actual hierarchy delimiter (via `LIST`) once during startup initialization, and SHALL translate every configured folder path (`FOLDER_INBOX`, `FOLDER_SPAM`, `FOLDER_SPAM_LOW`, `FOLDER_SPAM_HIGH`, `FOLDER_TRAIN_SPAM`, `FOLDER_TRAIN_HAM`, `FOLDER_TRAIN_WHITELIST`, `FOLDER_TRAIN_BLACKLIST`, `FOLDER_STATE`) from its delimiter-neutral configured form into a path using that real delimiter, in place, so that reading the setting afterward yields the resolved path.

#### Scenario: Dot-delimited server
- **WHEN** the IMAP server reports `.` as its hierarchy delimiter and a folder is configured as `INBOX.scanner.train.spam`
- **THEN** the folder setting's value, once resolved, SHALL read as `INBOX.scanner.train.spam`

#### Scenario: Slash-delimited server
- **WHEN** the IMAP server reports `/` as its hierarchy delimiter and a folder is configured as `INBOX.scanner.train.spam`
- **THEN** the folder setting's value, once resolved, SHALL read as `INBOX/scanner/train/spam`

### Requirement: Resolved paths are used for all folder operations
Every workflow operation that opens, searches, appends to, or moves messages to a configured folder SHALL, once resolution has run, use the delimiter-resolved value of that folder setting.

#### Scenario: Scan workflow opens the inbox
- **WHEN** the scan workflow opens the inbox folder to search for new messages, after startup resolution has run
- **THEN** it SHALL open the resolved `FOLDER_INBOX` value

#### Scenario: Training workflow moves a trained message
- **WHEN** the training workflow moves a learned message out of a training folder, after startup resolution has run
- **THEN** it SHALL move it using the resolved destination folder value

#### Scenario: State manager opens the state folder
- **WHEN** the state manager reads or writes scanner or map state, after startup resolution has run
- **THEN** it SHALL open the resolved `FOLDER_STATE` value

### Requirement: Folder resolution happens before any workflow uses folder paths
The system SHALL resolve all configured folder paths during the one-time startup init phase, before any training or scanning step runs, so every step in the same process run observes the same resolved values.

#### Scenario: Resolution runs once at startup
- **WHEN** the orchestrator starts and runs its one-time init phase
- **THEN** folder path resolution SHALL complete as part of that phase, before the first training or scanning step executes

#### Scenario: Resolution is safe to run more than once
- **WHEN** folder path resolution is run against a value that has already been resolved (e.g. resolution is accidentally triggered twice in the same process)
- **THEN** the value SHALL be unchanged by the second resolution (re-resolving an already-resolved path is a no-op, regardless of which delimiter character is in use)
