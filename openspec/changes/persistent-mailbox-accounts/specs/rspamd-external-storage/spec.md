# Spec Delta

## MODIFIED Requirements

### Requirement: SPAM_SCANNER_DATA documented in env example
The repo-root `.env.example` file SHALL include `SPAM_SCANNER_DATA` with a
comment noting that it is the host data directory used by docker-compose and
by the server for the mailbox accounts file, that `~` is not expanded by
Docker Compose, and that an absolute path MUST be used. The file is
generated from the server's `configGroups` via `npm run generate:env-example`.

#### Scenario: Developer follows example to configure data path
- **WHEN** a developer copies `.env.example` to `.env` and sets
  `SPAM_SCANNER_DATA`
- **THEN** compose bind mounts and the server's account file path both use
  that directory without further configuration

## ADDED Requirements

### Requirement: Server container mounts SPAM_SCANNER_DATA for account persistence
The root `docker-compose.yml` server service SHALL bind-mount
`${SPAM_SCANNER_DATA}` at the same path inside the container so the server
can read and write the mailbox accounts file on the host alongside rspamd
and Redis data.

#### Scenario: Accounts file survives container recreation
- **WHEN** the server container is recreated after an account was created
- **THEN** the server loads the same accounts from the host path under
  `SPAM_SCANNER_DATA`
