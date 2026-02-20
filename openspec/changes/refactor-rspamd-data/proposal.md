## Why

Rspamd's trained Bayes model (stored in Redis) and whitelist/blacklist maps are split across Docker named volumes scoped by project name — meaning local dev (`rspamd/` compose) and container mode (`spam-scanner/` root compose) use entirely separate training data. Switching between modes silently discards all prior training. Additionally, the `spam-scanner` container currently has no mount for the maps directory, making `train-whitelist.js` and `train-blacklist.js` silently write to a non-existent path inside the container.

## What Changes

- Move rspamd `data/`, `logs/`, `maps/` from `rspamd/` project subdirectory to `${SPAM_SCANNER_DATA}/rspamd/` (host path outside project, default: `~/.spam-scanner`)
- Move Redis from Docker named volume to bind mount at `${SPAM_SCANNER_DATA}/redis/` so both compose environments share the same Bayes corpus
- Move `rspamd/docker-compose.yml` to `bin/local/docker-compose.yml` (it belongs with local dev scripts); use `../../rspamd/config` for versioned config
- Update root `docker-compose.yml`: use `${SPAM_SCANNER_DATA}` volume paths; add maps bind mount + env vars to `spam-scanner` service (fixes the silent write bug)
- Update `src/lib/utils/config.js`: map path defaults derive from `SPAM_SCANNER_DATA` so local Node.js scripts work without explicit path config
- Add `SPAM_SCANNER_DATA` to `.env` and `.env.example`
- Rename `.env.pierre` → `.env.production` (clearer naming convention)
- `rspamd/config/` stays in project — it is versioned configuration, not runtime data

## Capabilities

### New Capabilities
- `rspamd-external-storage`: Host-based external storage for rspamd data, maps, logs, and Redis — shared across local dev and container compose environments via a single `SPAM_SCANNER_DATA` env var

### Modified Capabilities

_(none — no existing specs to delta against)_

## Impact

- `docker-compose.yml` — rspamd/redis volume mounts updated; `spam-scanner` service gains maps mount and map path env vars; named `redis-data` volume removed
- `rspamd/docker-compose.yml` — deleted
- `bin/local/docker-compose.yml` — new file (replaces above)
- `src/lib/utils/config.js` — `RSPAMD_WHITELIST_MAP_PATH` and `RSPAMD_BLACKLIST_MAP_PATH` defaults updated
- `.env`, `.env.example` — `SPAM_SCANNER_DATA` added
- `.env.pierre` — renamed to `.env.production`
