### Requirement: External data directory configurable via env var
The system SHALL use a single `SPAM_SCANNER_DATA` environment variable to define the base host directory for all persistent rspamd and Redis state. When not set, it SHALL default to `~/.spam-scanner` (resolved via `os.homedir()`).

#### Scenario: Default path used when env var absent
- **WHEN** `SPAM_SCANNER_DATA` is not set in the environment
- **THEN** the system SHALL resolve map paths under `~/.spam-scanner/rspamd/maps/`

#### Scenario: Custom path used when env var is set
- **WHEN** `SPAM_SCANNER_DATA=/mnt/data/spam` is set
- **THEN** the system SHALL resolve map paths under `/mnt/data/spam/rspamd/maps/`

---

### Requirement: Rspamd data, logs, and maps stored at external host path
The rspamd container SHALL mount its persistent directories (`/var/lib/rspamd`, `/var/log/rspamd`, `/etc/rspamd/maps`) from `${SPAM_SCANNER_DATA}/rspamd/data`, `${SPAM_SCANNER_DATA}/rspamd/logs`, and `${SPAM_SCANNER_DATA}/rspamd/maps` respectively.

#### Scenario: Both compose environments mount identical host paths
- **WHEN** the root `docker-compose.yml` and `bin/local/docker-compose.yml` are each started
- **THEN** both SHALL bind-mount the same `${SPAM_SCANNER_DATA}/rspamd/` subdirectories into the rspamd container

#### Scenario: Rspamd config remains in project
- **WHEN** either compose file starts the rspamd container
- **THEN** `/etc/rspamd/local.d` SHALL be mounted from `rspamd/config/` within the project repository

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

### Requirement: spam-scanner container can write map files
The `spam-scanner` service in the root `docker-compose.yml` SHALL have `${SPAM_SCANNER_DATA}/rspamd/maps` mounted into the container, and `RSPAMD_WHITELIST_MAP_PATH` / `RSPAMD_BLACKLIST_MAP_PATH` SHALL be injected as environment variables pointing to that mount path.

#### Scenario: train-whitelist writes to shared maps directory
- **WHEN** `train-whitelist.js` runs inside the `spam-scanner` container
- **THEN** it SHALL write to a path that is bind-mounted to `${SPAM_SCANNER_DATA}/rspamd/maps/whitelist.map` on the host

#### Scenario: rspamd reads the updated map
- **WHEN** the map file is updated by `spam-scanner`
- **THEN** rspamd SHALL serve the updated whitelist/blacklist because both containers mount the same host directory

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

---

### Requirement: Map path defaults derived from SPAM_SCANNER_DATA in config.js
`src/lib/utils/config.js` SHALL compute the default values for `RSPAMD_WHITELIST_MAP_PATH` and `RSPAMD_BLACKLIST_MAP_PATH` using `SPAM_SCANNER_DATA` (or `~/.spam-scanner` fallback), so local Node.js scripts work without explicitly setting the map path variables.

#### Scenario: Local script resolves map path without explicit config
- **WHEN** `node src/train-whitelist.js` is run locally with only `SPAM_SCANNER_DATA` set
- **THEN** `config.RSPAMD_WHITELIST_MAP_PATH` SHALL resolve to `${SPAM_SCANNER_DATA}/rspamd/maps/whitelist.map`

#### Scenario: Explicit map path env var takes precedence
- **WHEN** `RSPAMD_WHITELIST_MAP_PATH` is explicitly set in the environment
- **THEN** that value SHALL be used instead of the derived default
