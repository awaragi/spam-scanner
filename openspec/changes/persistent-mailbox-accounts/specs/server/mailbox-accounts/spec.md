## Purpose

Defines how the server durably stores mailbox account records (connection
info, enablement, and admin-controlled AI enablement), validates IMAP
connectivity before persisting changes, and exposes optimistic concurrency
for admin mutations.

## ADDED Requirements

### Requirement: Account records are stored in a versioned JSON file under SPAM_SCANNER_DATA
The server SHALL persist mailbox account records in a single JSON file at a
fixed relative name under the configured `SPAM_SCANNER_DATA` directory. The
file SHALL contain a monotonic integer `version` and an `accounts` array.
Each account record SHALL include the mailbox id (owner email), IMAP
connection fields (including the IMAP password in plain text), the state
folder name, `enabled`, and `aiEnabled`. The server SHALL NOT store account
records in environment variables.

#### Scenario: Missing accounts file on first start
- **WHEN** the server starts and the accounts file does not exist on disk
- **THEN** the server treats the registry as empty with version `0` and
  starts successfully with no mailbox runners

#### Scenario: First successful mutation creates the file
- **WHEN** an admin mutation successfully persists the first account
- **THEN** the server writes the accounts file under `SPAM_SCANNER_DATA`
  with version incremented from `0`

### Requirement: The account store is replaceable behind a narrow port
The server SHALL read and write account records through an account-store
abstraction that exposes load and conditional save operations. The initial
implementation SHALL use the JSON file described above. Application and API
layers SHALL depend on the abstraction, not on file format details.

#### Scenario: Registry reads through the store
- **WHEN** any component needs the list of managed mailboxes
- **THEN** it obtains that list from the account store (directly or via a
  repository backed by the store), not from environment configuration

### Requirement: Optimistic locking uses If-Match against the file version
Every mutation that changes the accounts file SHALL require the caller to
supply an `If-Match` header whose value equals the quote-wrapped current
file version from the caller's last read. The server SHALL reject a mutation
without `If-Match` with status 428. The server SHALL reject a stale
`If-Match` with status 409 and SHALL NOT apply the mutation. A successful
mutation SHALL increment the file version by exactly one.

#### Scenario: Stale If-Match is rejected
- **WHEN** a caller submits a mutation with `If-Match` for version `2` but
  the file is already at version `3`
- **THEN** the server responds with 409 and leaves the file unchanged

#### Scenario: Missing If-Match is rejected
- **WHEN** a caller submits a mutation with no `If-Match` header
- **THEN** the server responds with 428 and leaves the file unchanged

### Requirement: IMAP connectivity is verified before every account persistence except delete
Before writing any change to the accounts file (including create, update,
enable/disable, and changes that touch only `enabled` or `aiEnabled`), the
server SHALL attempt an IMAP connection using the effective connection
parameters for the affected account (merged update fields with stored
password when the request omits a new password) and SHALL close the
connection in a finally block. If the connection test fails, the server
SHALL reject the request and SHALL NOT modify the accounts file.

#### Scenario: Create fails IMAP test
- **WHEN** an admin creates an account with credentials that cannot connect
- **THEN** the server rejects the request and no new account is stored

#### Scenario: Enable persists only after successful IMAP test
- **WHEN** a caller enables a mailbox and the stored credentials connect
  successfully
- **THEN** the server persists `enabled: true` and starts or refreshes the
  runner as applicable

#### Scenario: Delete does not require IMAP test
- **WHEN** an admin deletes an account with a valid `If-Match`
- **THEN** the server removes the account from the file without opening IMAP

### Requirement: Duplicate mailbox ids are rejected before IMAP test on create
When creating an account, the server SHALL reject the request if an account
with the same id already exists, before running the IMAP connection test.

#### Scenario: Duplicate id on create
- **WHEN** an admin POSTs a new account whose id matches an existing account
- **THEN** the server rejects the request and does not run IMAP test or
  modify the file
