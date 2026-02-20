## 1. Prepare Host Environment

- [x] 1.1 Stop any running containers (`docker compose down` in project root and `rspamd/`)
- [x] 1.2 Create external directory structure: `mkdir -p ~/.spam-scanner/rspamd/{data,logs,maps} ~/.spam-scanner/redis`
- [x] 1.3 Create empty map files: `touch ~/.spam-scanner/rspamd/maps/whitelist.map ~/.spam-scanner/rspamd/maps/blacklist.map`
- [x] 1.4 Remove old Docker named volumes: `docker volume rm rspamd_redis-data spam-scanner_redis-data 2>/dev/null || true`
- [x] 1.5 Delete stale in-project runtime data: `rm -rf rspamd/data/* rspamd/logs/*`

## 2. Environment Variables

- [x] 2.1 Add `SPAM_SCANNER_DATA=/Users/pierre/.spam-scanner` to `.env` with comment noting `~` is not expanded by Docker Compose
- [x] 2.2 Add `SPAM_SCANNER_DATA` entry to `.env.example` with instructional comment (absolute path required, no `~`)
- [x] 2.3 Rename `.env.pierre` to `.env.production`

## 3. Local Dev Compose (bin/local/)

- [x] 3.1 Create `bin/local/docker-compose.yml` with rspamd, redis, and unbound services
- [x] 3.2 Mount rspamd config via `../../rspamd/config:/etc/rspamd/local.d`
- [x] 3.3 Mount rspamd data/logs/maps via `${SPAM_SCANNER_DATA}/rspamd/{data,logs,maps}`
- [x] 3.4 Mount Redis data via `${SPAM_SCANNER_DATA}/redis:/data` (bind mount, no named volume)
- [x] 3.5 Delete `rspamd/docker-compose.yml`

## 4. Root docker-compose.yml

- [x] 4.1 Update rspamd service volumes to use `${SPAM_SCANNER_DATA}/rspamd/{data,logs,maps}` for data, logs, and maps
- [x] 4.2 Keep rspamd config mount as `./rspamd/config:/etc/rspamd/local.d` (unchanged)
- [x] 4.3 Update redis service to use bind mount `${SPAM_SCANNER_DATA}/redis:/data` instead of named volume
- [x] 4.4 Add `${SPAM_SCANNER_DATA}/rspamd/maps:/data/rspamd/maps` volume to `spam-scanner` service
- [x] 4.5 Add `RSPAMD_WHITELIST_MAP_PATH=/data/rspamd/maps/whitelist.map` and `RSPAMD_BLACKLIST_MAP_PATH=/data/rspamd/maps/blacklist.map` to `spam-scanner` environment
- [x] 4.6 Remove the `redis-data` named volume declaration from the top-level `volumes:` block

## 5. Node.js Config

- [x] 5.1 In `src/lib/utils/config.js`, compute `dataDir` from `process.env.SPAM_SCANNER_DATA || path.join(homedir(), '.spam-scanner')`
- [x] 5.2 Update `RSPAMD_WHITELIST_MAP_PATH` default to `path.join(dataDir, 'rspamd/maps/whitelist.map')`
- [x] 5.3 Update `RSPAMD_BLACKLIST_MAP_PATH` default to `path.join(dataDir, 'rspamd/maps/blacklist.map')`
- [x] 5.4 Add `import path from 'path'` if not already present in `config.js`
