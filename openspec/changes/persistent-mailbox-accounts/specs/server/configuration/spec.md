# Spec Delta

## MODIFIED Requirements

### Requirement: Configuration keys are either app settings or mailbox connection info
The server's environment-variable schema SHALL recognize app settings, which
apply to the whole server (rspamd connection, the AI provider, the
scan/training interval, batch sizes, retry limits, logging, the HTTP port,
and the external data directory `SPAM_SCANNER_DATA`), and SHALL NOT
recognize mailbox connection info (IMAP credentials, mailbox id, state
folder, per-mailbox enabled, or per-mailbox AI enablement) as environment
variables. The schema SHALL NOT accept a per-mailbox behavioral setting
(folder names, thresholds, processing mode, AI escalation thresholds) as an
environment variable.

#### Scenario: A per-mailbox setting is not recognized as an env key
- **WHEN** the operator sets an environment variable corresponding to a
  per-mailbox behavioral setting (for example a spam threshold or a folder
  name)
- **THEN** the server does not read it as configuration; that setting is
  governed by its own default per the "Per-mailbox settings default from
  code" requirement below

#### Scenario: Mailbox connection env keys are not recognized
- **WHEN** the operator sets `MAILBOX_1_ID` or any other `MAILBOX_<n>_*`
  key in the environment
- **THEN** the server does not read it as configuration for mailbox
  registration

### Requirement: Configuration is validated once at bootstrap, all problems together
The server SHALL validate every configuration key exactly once, when the
application starts. When more than one field fails validation, the server
SHALL report every failure together in a single error rather than stopping
at the first one, and SHALL exit rather than start with invalid
configuration. The server SHALL start successfully when no mailbox accounts
are configured, provided all app settings validate.

#### Scenario: Two configuration fields are invalid at once
- **WHEN** the server starts with one field missing that has no safe
  default and a second field set to a value outside its allowed type or
  range
- **THEN** the server fails to start and reports both problems in the same
  error, not just the first one encountered

#### Scenario: Zero mailboxes configured
- **WHEN** the server starts with valid app settings and an empty account
  registry
- **THEN** the server starts and runs with no mailbox runners

### Requirement: The example environment file is generated from the schema and kept in sync
The server SHALL provide a generated example environment file that lists
every app-setting key, its default (where one exists), and its
documentation, rendered from the same schema that validates the running
server. The example file SHALL NOT list mailbox connection keys. The
project's test suite SHALL fail if the committed example file drifts from
what the schema currently renders.

#### Scenario: A key's default changes without regenerating the example file
- **WHEN** a configuration key's default value is changed in the schema but
  the committed example environment file is not regenerated
- **THEN** the test suite fails, naming the drift

## REMOVED Requirements

### Requirement: An operator can migrate an existing single-mailbox .env onto the server's schema
**Reason:** Mailbox connection info no longer lives in environment
variables; operators maintain `accounts.json` under `SPAM_SCANNER_DATA`
instead.

**Migration:** Use a one-off script or hand-edit the accounts file; the
server-provided env migration script for mailbox keys is removed or no
longer maps IMAP connection fields.
