# Spec Delta

## MODIFIED Requirements

### Requirement: The server discovers mailboxes through a mailbox registry
The server SHALL discover the mailboxes it manages through a single mailbox
registry that returns a list of mailboxes, so that every other part of the
server (scanning, training, folder init) is written against "the list of
mailboxes" and does not need to change when the registry's source changes.
The registry SHALL be backed by the durable account store defined in the
`server/mailbox-accounts` capability. The registry SHALL reflect account
additions, updates, and removals without requiring a server process restart.

#### Scenario: The server starts with the env-backed registry
- **WHEN** the server starts with one or more accounts in the account store
- **THEN** the mailbox registry returns a list containing every stored
  account, matching each account's connection configuration

#### Scenario: An account is added at runtime
- **WHEN** an admin successfully creates a new account through the API
- **THEN** the mailbox registry includes that mailbox on subsequent reads
  without restarting the process

### Requirement: A mailbox's id is its owner's email address, distinct from its IMAP login
Every mailbox SHALL have an id that is the email address of the person who
owns it. This id SHALL be stored and used separately from the mailbox's
IMAP login username, which may differ from it (for example, a bare
username on a self-hosted server). The id SHALL be immutable for the life
of an account record; changing it SHALL require deleting the account and
creating a new one.

#### Scenario: The IMAP login is not an email address
- **WHEN** a mailbox's IMAP login username is a bare username rather than
  an email address
- **THEN** the mailbox's id is still the owner's email address, read from
  the account record, not derived from the IMAP login
