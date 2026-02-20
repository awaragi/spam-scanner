## Context

Currently rspamd runtime state is split into three storage locations depending on which Docker Compose file is active:

- `rspamd/data/` and `rspamd/maps/` — bind-mounted consistently (same dir in both compose files), though not intentionally designed that way
- Redis Bayes corpus — stored in Docker **named volumes** (`rspamd_redis-data` when running `rspamd/docker-compose.yml`, `spam-scanner_redis-data` when running root `docker-compose.yml`). Docker scopes named volume names by project directory name, so these are always two separate volumes.

The result: training done in local dev mode (`rspamd/docker-compose.yml`) is invisible when switching to container mode (root `docker-compose.yml`), and vice versa.

A secondary bug: the `spam-scanner` container has no bind mount for the maps directory, so `train-whitelist.js` and `train-blacklist.js` silently write map files to a path that doesn't persist or reach rspamd.

The `rspamd/docker-compose.yml` is logically a local dev tool but lives alongside versioned rspamd config, creating confusion about what belongs in version control.

## Goals / Non-Goals

**Goals:**
- Single external host directory (`${SPAM_SCANNER_DATA}`) holds all rspamd and Redis persistent state
- Both compose files mount identical host paths — training in one mode is visible in the other
- `spam-scanner` container can write map files that rspamd actually reads
- `rspamd/config/` stays versioned in the project
- Local dev compose moves to `bin/local/` alongside other dev scripts
- All paths work on macOS and Linux without symlinks or wrappers

**Non-Goals:**
- Migrating existing trained data (retrain from scratch)
- Supporting multiple machines sharing the same trained data
- Changing rspamd configuration behaviour or scoring

## Decisions

### 1. Single `SPAM_SCANNER_DATA` env var for all external paths

**Decision:** One variable (`SPAM_SCANNER_DATA`) defines the base directory on the host. All derived paths (`rspamd/data`, `rspamd/maps`, `rspamd/logs`, `redis`) expand from it. In `src/lib/utils/config.js`, map path defaults also derive from it using `path.join(process.env.SPAM_SCANNER_DATA || path.join(homedir(), '.spam-scanner'), ...)`.

**Default:** `~/.spam-scanner` (resolved via `os.homedir()` in Node.js, set explicitly in `.env` for Docker Compose which doesn't expand `~`).

**Alternatives considered:**
- Separate `RSPAMD_DATA_DIR`, `RSPAMD_MAPS_DIR`, `REDIS_DATA_DIR` vars — more flexible but verbose; moving the whole data store requires changing 3 vars instead of 1
- Keeping data in `rspamd/` subdirectory — doesn't solve the Redis named volume problem, keeps 98MB of binary data in the project tree

### 2. Redis bind mount instead of named volume

**Decision:** Replace `redis-data` named Docker volume with a bind mount to `${SPAM_SCANNER_DATA}/redis/`. Both compose files use the same path.

**Alternatives considered:**
- Keeping named volume, exporting/importing between the two — complex, error-prone, breaks on every compose project rename
- Using a single compose file with profiles — valid but larger refactor; out of scope for this change

### 3. `rspamd/docker-compose.yml` moves to `bin/local/docker-compose.yml`

**Decision:** Move the file to `bin/local/` where it belongs semantically (local dev tooling, not versioned rspamd config). Use `../../rspamd/config` as the relative path for the config bind mount — this resolves correctly regardless of working directory when the file is invoked.

**Alternatives considered:**
- `${PROJECT_ROOT}/rspamd/config` via a second env var — readable but adds coupling
- Keeping file in `rspamd/` — maintains the ambiguity about what's config vs tooling

### 4. `spam-scanner` container gets maps mount + env override

**Decision:** Add `${SPAM_SCANNER_DATA}/rspamd/maps:/data/rspamd/maps` to the `spam-scanner` service volumes, and inject `RSPAMD_WHITELIST_MAP_PATH` / `RSPAMD_BLACKLIST_MAP_PATH` as environment variables pointing to `/data/rspamd/maps/*.map`. This fixes the silent write bug and makes the same map files visible to rspamd.

### 5. `.env.pierre` renamed to `.env.production`

**Decision:** Rename to `.env.production` to signal intent: this is the machine-specific production configuration. `.env` remains the active config at runtime (git-ignored, copied from `.env.production` or `.env.example` on a new machine).

## Risks / Trade-offs

- **macOS bind mount I/O performance** → rspamd does frequent small writes to `data/`. Docker Desktop on macOS has known overhead for bind mounts. In practice the 98MB Hyperscan cache and RRD stats are write-infrequent enough that this is unlikely to matter. Monitor if rspamd feels slow after the change.

- **`~` not expanded in Docker Compose `env_file`** → `SPAM_SCANNER_DATA=~/.spam-scanner` will not work in `.env` because Docker Compose does not shell-expand `~`. The `.env` file must use an absolute path (e.g. `/Users/pierre/.spam-scanner`). `.env.example` will document this with a comment.

- **First-run directory creation** → If `${SPAM_SCANNER_DATA}/rspamd/data` doesn't exist when the container starts, rspamd may fail. A `README` or `bin/local/` helper should document the one-time `mkdir` command. The rspamd image may also create the dirs itself on first start — acceptable risk.

- **`../../rspamd/config` path** → Works when `docker compose` is invoked from any directory. If someone moves `bin/local/docker-compose.yml` to a different nesting depth the path breaks. Acceptable; the location is stable.

## Migration Plan

No data migration. Steps to deploy:

> **AI agent executes steps 1–6. Human executes steps 7–8.**

1. Stop all running containers (`docker compose down` in both locations)
2. Create external directory structure:
   ```bash
   mkdir -p ~/.spam-scanner/rspamd/{data,logs,maps} ~/.spam-scanner/redis
   touch ~/.spam-scanner/rspamd/maps/whitelist.map
   touch ~/.spam-scanner/rspamd/maps/blacklist.map
   ```
3. Add `SPAM_SCANNER_DATA=/Users/<you>/.spam-scanner` to `.env`
4. Delete old Docker named volumes (they will not be used):
   ```bash
   docker volume rm rspamd_redis-data spam-scanner_redis-data 2>/dev/null || true
   ```
5. Delete `rspamd/data/*` and `rspamd/logs/*` (now external)
6. Apply code changes (compose files, config.js, .env files)
7. _(Human)_ Start local dev stack: `docker compose -f bin/local/docker-compose.yml up -d`
8. _(Human)_ Retrain: run `train-spam`, `train-ham`, `train-whitelist`, `train-blacklist`

**Rollback:** Restore old compose files from git, run `docker compose up` from `rspamd/`. Named volumes will be recreated empty on first start.

## Open Questions

_(none — all decisions resolved during exploration)_
