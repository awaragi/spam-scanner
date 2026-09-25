# Spec Delta

## Purpose

Governs how the server reads and validates its environment-variable-sourced
configuration: what counts as an app setting versus a mailbox's connection
info, when validation runs and how failures are reported, and how an
operator migrates an existing single-mailbox `.env` onto the server's
smaller, split schema.

## ADDED Requirements

### Requirement: Configuration keys are either app settings or mailbox connection info
The server's environment-variable schema SHALL recognize exactly two kinds
of key: app settings, which apply to the whole server (rspamd connection,
the AI provider, the scan/training interval, batch sizes, retry limits,
logging, and the HTTP port), and one mailbox's connection info (its id,
IMAP connection details, and state folder). The schema SHALL NOT accept a
per-mailbox behavioral setting (folder names, thresholds, processing mode,
AI escalation thresholds, or an AI opt-out) as an environment variable.

#### Scenario: A per-mailbox setting is not recognized as an env key
- **WHEN** the operator sets an environment variable corresponding to a
  per-mailbox behavioral setting (for example a spam threshold or a folder
  name)
- **THEN** the server does not read it as configuration; that setting is
  governed by its own default per the "Per-mailbox settings default from
  code" requirement below

### Requirement: Configuration is validated once at bootstrap, all problems together
The server SHALL validate every configuration key exactly once, when the
application starts. When more than one field fails validation, the server
SHALL report every failure together in a single error rather than stopping
at the first one, and SHALL exit rather than start with invalid
configuration.

#### Scenario: Two configuration fields are invalid at once
- **WHEN** the server starts with one field missing that has no safe
  default and a second field set to a value outside its allowed type or
  range
- **THEN** the server fails to start and reports both problems in the same
  error, not just the first one encountered

### Requirement: The example environment file is generated from the schema and kept in sync
The server SHALL provide a generated example environment file that lists
every app-setting key and every mailbox-connection key, its default (where
one exists), and its documentation, rendered from the same schema that
validates the running server. The project's test suite SHALL fail if the
committed example file drifts from what the schema currently renders.

#### Scenario: A key's default changes without regenerating the example file
- **WHEN** a configuration key's default value is changed in the schema but
  the committed example environment file is not regenerated
- **THEN** the test suite fails, naming the drift

### Requirement: An operator can migrate an existing single-mailbox .env onto the server's schema
The server SHALL provide a script that reads an existing single-mailbox
environment file (in the shape used before the server existed) and writes
a new environment file matching the server's schema, given an input path
and an output path.

The script SHALL:
- keep every value belonging to an app-setting key unchanged;
- map the source file's IMAP connection keys and state-folder key onto the
  server's mailbox-connection keys;
- derive the mailbox id from an email-address-shaped value found in the
  source file, when one is present, or leave the mailbox id empty and warn
  when none is found;
- omit every key that is per-mailbox behavioral configuration or otherwise
  not part of the server's schema, silently dropping it rather than
  carrying it forward;
- fill in the schema's own default for any server key the source file does
  not set.

The script SHALL NOT print, log, or otherwise surface the value of any
key it reads or writes — only key names and counts.

#### Scenario: Migrating a typical existing environment file
- **WHEN** the operator runs the migration script against an existing
  single-mailbox environment file that sets IMAP connection details, a
  state folder, and per-mailbox thresholds, alongside app settings like the
  rspamd URL and AI provider configuration
- **THEN** the generated output file contains the app settings unchanged,
  the mailbox connection info mapped to the server's key names, no
  per-mailbox threshold keys, and defaults filled in for any server key the
  source file never set

#### Scenario: No email-shaped value is available to derive a mailbox id
- **WHEN** the source environment file's IMAP user and notification address
  (or their equivalents) contain no value shaped like an email address
- **THEN** the generated output file's mailbox id is left empty and the
  script warns the operator that it must be filled in by hand

#### Scenario: The migration script never surfaces a secret value
- **WHEN** the migration script runs against a source file containing an
  IMAP password, an rspamd password, and an AI API key
- **THEN** nothing printed by the script, on success or failure, contains
  the value of any of those keys

### Requirement: Per-mailbox settings default from code, with no environment override
Every per-mailbox behavioral setting (folder names, scan behavior,
processing mode and labels, spam thresholds, AI escalation thresholds, and
whether AI is used for that mailbox) SHALL have a default defined in the
server's code. Until a mailbox has its own stored override, it SHALL run
on these code defaults. The server SHALL NOT read any of these settings
from an environment variable.

#### Scenario: A mailbox has no stored settings override
- **WHEN** a mailbox has never had any per-mailbox setting explicitly set
- **THEN** every per-mailbox setting used for that mailbox is the value
  defined in the server's code, regardless of what is set in the
  environment
