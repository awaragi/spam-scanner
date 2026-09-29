# Spec Delta

## MODIFIED Requirements

### Requirement: Configuration keys are either app settings or mailbox connection info
The server's environment-variable schema SHALL recognize exactly two kinds
of key: app settings, which apply to the whole server (rspamd connection,
the AI provider, the scan/training interval, batch sizes, retry limits,
logging, and the HTTP port), and one mailbox's connection info (its id,
IMAP connection details, state folder, and whether its runner is enabled).
The schema SHALL NOT accept a per-mailbox behavioral setting (folder names,
thresholds, processing mode, AI escalation thresholds, or an AI opt-out) as
an environment variable.

A mailbox's enabled flag SHALL default to enabled when not set, so an
existing deployment that never sets the key keeps running every configured
mailbox exactly as before this key existed.

#### Scenario: A per-mailbox setting is not recognized as an env key
- **WHEN** the operator sets an environment variable corresponding to a
  per-mailbox behavioral setting (for example a spam threshold or a folder
  name)
- **THEN** the server does not read it as configuration; that setting is
  governed by its own default per the "Per-mailbox settings default from
  code" requirement below

#### Scenario: A mailbox is configured as disabled
- **WHEN** the operator sets that mailbox's enabled key to a false-like
  value
- **THEN** the server's resolved configuration for that mailbox reports it
  as disabled

#### Scenario: A mailbox's enabled key is not set
- **WHEN** the operator configures a mailbox's connection info without
  setting its enabled key
- **THEN** the server's resolved configuration for that mailbox reports it
  as enabled
