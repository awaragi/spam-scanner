# Spec Delta

## Purpose

Owns whitelist/blacklist as an app-managed capability: per-mailbox, IMAP-backed storage of sender addresses, and how list membership is applied during scanning — a blacklist match is an absolute override, a whitelist match is a score adjustment that content can still override — entirely decoupled from rspamd, which stays a stateless content scorer safe to share across mailboxes.

## ADDED Requirements

### Requirement: List membership is stored per mailbox in the IMAP state folder

The system SHALL store whitelist and blacklist membership as state in the mailbox's own IMAP state folder (the same folder and read/write mechanism used for scanner state), not in a file on local disk. Each mailbox scanner instance SHALL only ever read and write its own mailbox's list state.

#### Scenario: List state travels with the mailbox

- **WHEN** a whitelist or blacklist entry is added via training
- **THEN** it SHALL be persisted to that mailbox's IMAP state folder, not to a file on the host filesystem

#### Scenario: Independent mailboxes do not share list state

- **WHEN** two separate mailbox scanner instances (potentially sharing one rspamd instance) each train their own whitelist/blacklist
- **THEN** an entry trained in one mailbox's state folder SHALL have no effect on the other mailbox's list matching

### Requirement: Sender addresses are normalized for storage and matching

The system SHALL normalize an email address (trim whitespace, lowercase) before storing it in a list and before comparing an incoming message's sender address against a list, so that matching is case-insensitive and whitespace-insensitive.

#### Scenario: Case and whitespace differences still match

- **WHEN** `Sender@Example.COM` is stored as a whitelist entry and an incoming message's sender address is `sender@example.com`
- **THEN** the incoming message SHALL be treated as a whitelist match

### Requirement: Blacklist membership is an absolute override

When an incoming message's sender address (`envelope.from`) matches an entry in the mailbox's blacklist, the system SHALL treat the message as `confirmed` spam unconditionally, without calling rspamd and without submitting it to AI classification.

#### Scenario: Blacklisted sender is confirmed spam regardless of content

- **WHEN** a message's sender address matches a blacklist entry
- **THEN** the system SHALL classify the message as `confirmed` without checking its content against rspamd

#### Scenario: Non-blacklisted sender is unaffected

- **WHEN** a message's sender address does not match any blacklist entry
- **THEN** the blacklist SHALL have no effect on the message's classification

### Requirement: Whitelist membership adjusts rspamd's score rather than overriding classification

When an incoming message's sender address matches an entry in the mailbox's whitelist, the system SHALL subtract 20 from rspamd's returned score before the message is categorized, rather than assigning the message a fixed disposition independent of that score.

#### Scenario: Whitelisted sender gets a score discount, not immunity

- **WHEN** a message's sender address matches a whitelist entry and rspamd returns a content score
- **THEN** the system SHALL use `score - 20` for categorization instead of the raw rspamd score

#### Scenario: Severe content still overrides a whitelist match

- **WHEN** a whitelisted sender's message content is severe enough that its whitelist-adjusted score still meets the `confirmed` threshold
- **THEN** the message SHALL still be classified as `confirmed`, notwithstanding the whitelist match

#### Scenario: A whitelisted sender's message keeps its actual tier, not a blanket "clean"

- **WHEN** a whitelisted sender's message content is elevated enough that its whitelist-adjusted score lands in the `high` tier (below `confirmed`)
- **THEN** the message SHALL be classified `high` - the same disposition (e.g. `Spam:High` label or `FOLDER_SPAM_HIGH`) any other `high`-tier message receives - and SHALL NOT be silently treated as `clean` merely because its sender is whitelisted

### Requirement: A sender listed on both lists is treated as blacklisted

When a message's sender address matches both the whitelist and the blacklist, the system SHALL treat it as blacklisted: it SHALL be classified as `confirmed` unconditionally, and the whitelist match SHALL have no mitigating effect.

#### Scenario: Both-listed sender is confirmed spam

- **WHEN** a message's sender address matches an entry in both the whitelist and the blacklist
- **THEN** the message SHALL be classified as `confirmed`, the same as if only the blacklist had matched

### Requirement: Training folders write to the IMAP-backed list store

The whitelist/blacklist training workflows (driven by the `train.whitelist`/`train.blacklist` IMAP folders) SHALL write extracted sender addresses to the mailbox's IMAP-backed list state, not to a local file.

#### Scenario: Training a whitelist entry

- **WHEN** a message is processed from the whitelist training folder and a sender address is extracted from it
- **THEN** that address SHALL be added to the mailbox's IMAP-backed whitelist state

#### Scenario: Training a blacklist entry

- **WHEN** a message is processed from the blacklist training folder and a sender address is extracted from it
- **THEN** that address SHALL be added to the mailbox's IMAP-backed blacklist state

### Requirement: List state is stored as human-readable JSON; anything else is treated as absent

The system SHALL store list state as a JSON array of normalized addresses, pretty-printed (indented) so the raw state message is human-readable without a JSON formatter, and SHALL read it as JSON. If a list state message exists but its body does not parse as the expected JSON shape (including the legacy newline-delimited plain-text content `writeMapState` wrote as a backup before this capability existed), the system SHALL treat that list the same as if no state message existed at all — per the "no matches when no list state exists yet" requirement — rather than attempting to interpret it or erroring.

#### Scenario: Reading a JSON-formatted list

- **WHEN** a mailbox's list state folder contains a message written in the JSON format
- **THEN** the system SHALL parse it as JSON and use its address list directly

#### Scenario: Stored state is indented, not minified

- **WHEN** list state is written
- **THEN** the JSON body SHALL be indented (not a single unbroken line), so it can be read directly from the raw message

#### Scenario: Pre-existing non-JSON content is ignored, not migrated implicitly

- **WHEN** a mailbox's list state folder contains a message whose body is not valid JSON (for example, a legacy plain-text backup written before this capability existed)
- **THEN** the system SHALL treat that list as empty — no message SHALL be classified as blacklisted or have its score adjusted for a whitelist match — until the import script (below) or training writes a valid JSON state for it

### Requirement: An import tool loads a text or JSON file into the list store

The system SHALL provide a command-line script that takes a source file path as a CLI argument (not derived from any configured map-file path or mount) and writes its addresses into the target mailbox's IMAP-backed list store. The script SHALL use the application's existing `.env` configuration for IMAP connection details and state-folder/key configuration, but SHALL NOT depend on `RSPAMD_WHITELIST_MAP_PATH`/`RSPAMD_BLACKLIST_MAP_PATH` or any Docker bind mount to locate its input. The script SHALL require the operator to specify, via CLI options, which list to import (`whitelist` or `blacklist`), the source file path, and a mode: `append` (merge the source file's addresses with any already in the IMAP-backed list) or `override` (replace the IMAP-backed list's contents with exactly the source file's addresses). The script SHALL also accept a `--format` option, defaulting to `txt`:

- `txt`: the source file is a newline-delimited, one-address-per-line list (the legacy rspamd map format `whitelist.map`/`blacklist.map` have always used)
- `json`: the source file is a JSON array of addresses (the same shape the export tool below produces, and the same shape list state is stored in)

Either format's addresses are normalized (see "Sender addresses are normalized...") before being merged/applied.

#### Scenario: File path is an explicit CLI argument

- **WHEN** the import script is invoked with a file path pointing anywhere on the local filesystem the operator running it can read
- **THEN** the script SHALL import from that file, regardless of whether it matches any configured map-path env var or mount

#### Scenario: Selecting which list to import

- **WHEN** the import script is run for `whitelist`
- **THEN** only the whitelist SHALL be read from the source file and written to the IMAP-backed whitelist store, and the blacklist SHALL be unaffected

#### Scenario: Text format is the legacy map format

- **WHEN** the import script is run with `--format txt` (or `--format` omitted) against a newline-delimited source file
- **THEN** each line SHALL be normalized and treated as one address

#### Scenario: JSON format is a JSON array of addresses

- **WHEN** the import script is run with `--format json` against a file containing a JSON array of address strings
- **THEN** each array entry SHALL be normalized and treated as one address

#### Scenario: Append mode merges with existing entries

- **WHEN** the import script is run in `append` mode and the IMAP-backed list already has entries
- **THEN** the resulting list SHALL contain the union of the existing entries and the source file's addresses, with no duplicates

#### Scenario: Override mode replaces existing entries

- **WHEN** the import script is run in `override` mode
- **THEN** the resulting IMAP-backed list SHALL contain exactly the source file's addresses, and any entry previously in the IMAP-backed list but absent from the source file SHALL be removed

#### Scenario: Re-running append mode is idempotent

- **WHEN** the import script is run twice in a row in `append` mode against the same source file
- **THEN** the resulting IMAP-backed list SHALL contain the same addresses as running it once, with no duplicates

#### Scenario: Import merges with, rather than discards, existing entries

- **WHEN** the mailbox's IMAP-backed list already contains entries (for example, trained since upgrading) and the import script is then run against a legacy local file
- **THEN** the resulting list SHALL contain the union of both sources, and no previously-existing entry SHALL be lost

### Requirement: An export tool dumps a mailbox's list for backup or migration

The system SHALL provide a command-line script that reads a mailbox's IMAP-backed whitelist or blacklist and writes it out as either format:

- `txt`: one normalized address per line (the legacy map format), for a human-readable or `import --format txt`-compatible dump
- `json`: the list's raw JSON array, unmodified, for a byte-for-byte backup or an `import --format json`-compatible transfer to another mailbox

The script SHALL require the operator to specify which list to export (`whitelist` or `blacklist`) and SHALL accept a `--format` option (defaulting to `txt`). Output SHALL go to a file when one is specified, or to standard output otherwise, so the script can be piped or redirected.

#### Scenario: Exporting to a file

- **WHEN** the export script is run with a destination file path
- **THEN** the selected list SHALL be written to that file in the requested format

#### Scenario: Exporting to standard output

- **WHEN** the export script is run without a destination file
- **THEN** the selected list SHALL be written to standard output in the requested format

#### Scenario: JSON export round-trips through import

- **WHEN** a list is exported with `--format json` from one mailbox and then imported with `--format json` (in `override` mode) into another mailbox
- **THEN** the destination mailbox's list SHALL contain exactly the same addresses as the source mailbox's list at export time

#### Scenario: Exporting an empty list

- **WHEN** the export script is run against a list with no entries
- **THEN** it SHALL produce an empty text output (or an empty JSON array for `--format json`) rather than failing

### Requirement: A combined tool backs up and restores a mailbox's full app state in one file

The system SHALL provide a command-line export script that bundles a mailbox's scanner state, whitelist, and blacklist into a single JSON file (or standard output), and a corresponding import script that restores all three from that same file into a mailbox — the destination for a restore MAY be a different mailbox than the one exported from, so this doubles as a way to move an entire configuration (progress plus both lists) between accounts. The bundle SHALL be a single JSON object with `scannerState`, `whitelist`, and `blacklist` keys, pretty-printed for readability. The import script SHALL accept a `--mode` option (`append`/`override`, default `append`) governing how `whitelist`/`blacklist` entries are merged with the destination mailbox's existing lists, per the same semantics as the single-list import tool; `scannerState`, if present in the file, SHALL always fully replace the destination's current scanner state (consistent with how scanner state has always been written — it has no merge concept). The import script SHALL restore only the keys present in the bundle, so a hand-edited or partial file (e.g. lists only, no `scannerState`) is valid input.

#### Scenario: Export bundles all three into one file

- **WHEN** the export script is run against a mailbox with scanner state and both lists populated
- **THEN** the resulting file SHALL contain a `scannerState` object, a `whitelist` array, and a `blacklist` array reflecting that mailbox's current state

#### Scenario: Import restores all three from one file

- **WHEN** the import script is run with a bundle file containing all three keys
- **THEN** the destination mailbox's scanner state SHALL be replaced with the bundle's `scannerState`, and its whitelist/blacklist SHALL be updated per `--mode` from the bundle's `whitelist`/`blacklist` arrays

#### Scenario: Moving configuration to a different mailbox

- **WHEN** the export script is run against one mailbox and the resulting file is used with the import script against a different mailbox's IMAP connection
- **THEN** the destination mailbox SHALL end up with the source mailbox's scanner state and list contents, independent of whatever destination-specific values existed before (in `override` mode) or merged with them (in `append` mode for the lists)

#### Scenario: Partial bundle restores only what's present

- **WHEN** the import script is run with a file containing only `whitelist` and `blacklist` (no `scannerState` key)
- **THEN** only the whitelist and blacklist SHALL be updated, and the destination mailbox's existing scanner state SHALL be left untouched

### Requirement: No matches when no list state exists yet

When a mailbox has no whitelist or blacklist state yet (nothing has been trained), the system SHALL treat every sender as unmatched for that list, rather than failing or refusing to scan.

#### Scenario: Fresh mailbox with no training history

- **WHEN** a scan runs against a mailbox that has never had a whitelist or blacklist entry trained
- **THEN** no message SHALL be classified as blacklisted or have its score adjusted for a whitelist match
