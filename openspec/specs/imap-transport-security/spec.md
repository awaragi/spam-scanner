# imap-transport-security Specification

## Purpose

Governs how the IMAP client's transport encryption is configured, so that disabling
direct TLS requires an explicit second opt-in and never silently degrades to an
unenforced, downgrade-attack-prone connection.

## Requirements

### Requirement: Disabling IMAP_TLS logs a warning

When configuration loads with `IMAP_TLS=false` (and therefore `IMAP_ALLOW_INSECURE=true`,
per `config-validation`), the system SHALL log a `warn`-level message noting that the
direct-TLS wrapper for the IMAP connection is disabled.

#### Scenario: A warning is logged when insecure mode is active

- **WHEN** configuration loads with `IMAP_TLS=false` and `IMAP_ALLOW_INSECURE=true`
- **THEN** a `warn`-level log entry is emitted noting IMAP transport encryption's
  direct-TLS wrapper is disabled

#### Scenario: No warning is logged in the default (secure) configuration

- **WHEN** configuration loads with `IMAP_TLS` at its default (`true`)
- **THEN** no such warning is logged

### Requirement: STARTTLS is enforced, not merely attempted, whenever direct TLS is disabled

When `IMAP_TLS=false`, the IMAP client SHALL be configured to require a successful
STARTTLS upgrade before authenticating, rather than attempting it opportunistically and
silently continuing in plaintext if the upgrade isn't available.

#### Scenario: The IMAP client enforces STARTTLS when IMAP_TLS is false

- **WHEN** the IMAP client is constructed with `IMAP_TLS=false`
- **THEN** it is configured to require STARTTLS before authenticating, so the
  connection attempt fails if the server does not support or offer STARTTLS, rather
  than silently continuing unencrypted

### Requirement: STARTTLS enforcement does not apply when direct TLS is enabled

When `IMAP_TLS` is at its default (`true`), the IMAP client's STARTTLS behavior SHALL be
left unconfigured (library default), since a direct TLS connection already provides
transport encryption and explicitly requiring STARTTLS in addition to a direct TLS
connection is invalid.

#### Scenario: The IMAP client does not set STARTTLS enforcement when IMAP_TLS is true

- **WHEN** the IMAP client is constructed with `IMAP_TLS` at its default (`true`)
- **THEN** it is not configured with an explicit STARTTLS requirement
