# rspamd-external-storage Specification

## Purpose

Keeps rspamd's and Redis's persistent state (Bayes corpus, logs, list data) on a host directory external to the containers, shared identically between the production and local-dev Compose stacks, so training data survives container recreation and both environments stay in sync.

## Requirements

### Requirement: Rspamd data, logs, and maps stored at external host path

The rspamd container SHALL mount its persistent directories (`/var/lib/rspamd`, `/var/log/rspamd`) from `${SPAM_SCANNER_DATA}/rspamd/data` and `${SPAM_SCANNER_DATA}/rspamd/logs` respectively. The rspamd container SHALL NOT mount any map directory — rspamd no longer reads whitelist/blacklist data from disk.

#### Scenario: Both compose environments mount identical host paths

- **WHEN** the root `docker-compose.yml` and `bin/local/docker-compose.yml` are each started
- **THEN** both SHALL bind-mount the same `${SPAM_SCANNER_DATA}/rspamd/data` and `${SPAM_SCANNER_DATA}/rspamd/logs` paths into the rspamd container

#### Scenario: Rspamd config remains in project

- **WHEN** either compose file starts the rspamd container
- **THEN** `/etc/rspamd/local.d` SHALL be mounted from `rspamd/config/` within the project repository

#### Scenario: No maps directory is mounted

- **WHEN** either compose file starts the rspamd container
- **THEN** no `${SPAM_SCANNER_DATA}/rspamd/maps` (or equivalent) directory SHALL be mounted into it

---

### Requirement: Redis data stored at external host path as bind mount

The Redis container SHALL use a bind mount at `${SPAM_SCANNER_DATA}/redis/` for `/data` instead of a Docker named volume, so both compose environments share the same Bayes corpus.

#### Scenario: No named volume created for Redis

- **WHEN** either compose file starts
- **THEN** no Docker named volume SHALL be created for Redis data

#### Scenario: Same Bayes corpus visible in both modes

- **WHEN** the system is trained using `bin/local/docker-compose.yml`
- **THEN** starting the root `docker-compose.yml` SHALL use the same trained Bayes data without retraining

---

### Requirement: Local dev compose located in bin/local/

The file `bin/local/docker-compose.yml` SHALL replace `rspamd/docker-compose.yml` as the local development compose file for rspamd and Redis.

#### Scenario: Config path resolves from any working directory

- **WHEN** `docker compose -f bin/local/docker-compose.yml up` is invoked from any directory
- **THEN** the rspamd config bind mount SHALL resolve to `rspamd/config/` in the project via `--project-directory` pointing to the project root

---

### Requirement: SPAM_SCANNER_DATA documented in env example

The `.env.example` file SHALL include `SPAM_SCANNER_DATA` with a comment noting that `~` is not expanded by Docker Compose and an absolute path MUST be used.

#### Scenario: Developer follows example to configure data path

- **WHEN** a developer copies `.env.example` to `.env` and sets `SPAM_SCANNER_DATA`
- **THEN** both compose files and Node.js scripts SHALL use that path without further configuration
