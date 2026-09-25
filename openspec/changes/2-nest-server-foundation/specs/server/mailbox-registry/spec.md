# Spec Delta

## Purpose

Defines what a mailbox is to the server, how the server discovers which
mailboxes it manages, and how a mailbox's internal identity — separate from
how it logs into IMAP — is derived and used.

## ADDED Requirements

### Requirement: The server discovers mailboxes through a mailbox registry
The server SHALL discover the mailboxes it manages through a single mailbox
registry that returns a list of mailboxes, so that every other part of the
server (scanning, training, folder init) is written against "the list of
mailboxes" and does not need to change when the registry's source changes.
For this change, the registry SHALL be backed by environment configuration
and SHALL return exactly one mailbox, built from the mailbox-connection
configuration described in the `server/configuration` capability.

#### Scenario: The server starts with the env-backed registry
- **WHEN** the server starts with mailbox-connection configuration set in
  its environment
- **THEN** the mailbox registry returns a list containing exactly one
  mailbox, matching that configuration

### Requirement: A mailbox's id is its owner's email address, distinct from its IMAP login
Every mailbox SHALL have an id that is the email address of the person who
owns it. This id SHALL be stored and used separately from the mailbox's
IMAP login username, which may differ from it (for example, a bare
username on a self-hosted server).

#### Scenario: The IMAP login is not an email address
- **WHEN** a mailbox's IMAP login username is a bare username rather than
  an email address
- **THEN** the mailbox's id is still the owner's email address, read from
  its own configuration value, not derived from the IMAP login

### Requirement: A mailbox's rspamd user is always its mailbox id
For every mailbox, the identifier the server uses to address that
mailbox's data in rspamd (its "rspamd user") SHALL always equal that
mailbox's id. This SHALL NOT be a separately configurable value: no
environment variable, stored setting, or per-mailbox override SHALL be
able to set a mailbox's rspamd user to anything other than its own mailbox
id.

#### Scenario: No configuration path can change a mailbox's rspamd user
- **WHEN** the server resolves which rspamd user to use for a given
  mailbox's rspamd requests
- **THEN** the value used is always that mailbox's id, regardless of any
  environment variable or stored setting present for that mailbox
