# Spec Delta

## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: External data directory configurable via env var

**Reason**: This requirement's observable behavior was config.js deriving `RSPAMD_WHITELIST_MAP_PATH`/`RSPAMD_BLACKLIST_MAP_PATH` from `SPAM_SCANNER_DATA`. Once those config keys are removed (list matching moves entirely into app code / IMAP state, per the `sender-lists` capability), config.js no longer derives any path from `SPAM_SCANNER_DATA` — it is only consumed by Docker Compose for the rspamd/Redis data and log mounts, which is already covered by "Rspamd data and logs stored at external host path" and the Redis bind-mount requirement.
**Migration**: None for operators — `SPAM_SCANNER_DATA` remains a required env var for `docker-compose.yml` exactly as before; only its use inside `config.js` for map paths goes away.

### Requirement: spam-scanner container can write map files

**Reason**: Blacklist matching moves entirely into app code, keyed by an IMAP-backed per-mailbox store (see the `sender-lists` capability) — it never reaches rspamd or a shared file. Whitelist matching becomes a post-hoc score adjustment applied in app code after rspamd's content-only response, also never written to a file rspamd reads. There is no longer any file for the `spam-scanner` and `rspamd` containers to share.
**Migration**: `RSPAMD_WHITELIST_MAP_PATH`/`RSPAMD_BLACKLIST_MAP_PATH` env vars and the `${SPAM_SCANNER_DATA}/rspamd/maps` bind mount on the `spam-scanner` service are removed from `docker-compose.yml`. Operators do not need to take any action.

### Requirement: Map path defaults derived from SPAM_SCANNER_DATA in config.js

**Reason**: `RSPAMD_WHITELIST_MAP_PATH`/`RSPAMD_BLACKLIST_MAP_PATH` are deleted from `config.js` entirely — there is no map path left to derive a default for.
**Migration**: Operators who have `RSPAMD_WHITELIST_MAP_PATH`/`RSPAMD_BLACKLIST_MAP_PATH` set in their environment should remove them; they are no longer read.
