# Spec Delta

## MODIFIED Requirements

### Requirement: A mailbox token holder can read and update that mailbox's settings
The server SHALL expose mailbox-scoped endpoints to read the mailbox's
currently resolved settings, alongside which top-level settings keys
currently have a stored override, and to update its settings overrides. An
update SHALL apply through the server's existing update-by-restart behavior:
validate the overrides, stop the mailbox's runner, write the new settings,
and start a fresh runner. An update that fails validation SHALL be rejected
without stopping the runner or writing anything.

#### Scenario: Reading settings returns the resolved settings
- **WHEN** a mailbox token holder reads its mailbox's settings
- **THEN** the server returns the settings currently in effect for that
  mailbox, together with the list of top-level keys that have an actual
  stored override (as opposed to a value that merely equals its code
  default)

#### Scenario: A mailbox with no stored overrides reports none
- **WHEN** a mailbox token holder reads the settings of a mailbox that has
  never had its settings updated
- **THEN** the server returns the default-resolved settings and an empty
  list of overridden keys

#### Scenario: A valid update restarts the mailbox with new settings
- **WHEN** a mailbox token holder submits a valid settings update
- **THEN** the server validates it, writes the new settings, and the
  mailbox's fresh runner uses them

#### Scenario: An invalid update is rejected without side effects
- **WHEN** a mailbox token holder submits a settings update that fails
  validation
- **THEN** the server rejects the request and the mailbox's runner and stored
  settings are left unchanged
