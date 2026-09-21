# Proposal

## Why

`docker-compose.yml` (production) and `bin/local/docker-compose.yml` (dev) define
identical `rspamd`/`redis`/`unbound`/`networks` blocks side by side (verified: the two
files are byte-identical for those sections, differing only in a header comment and
the production file's extra `spam-scanner` service). Any future edit to rspamd,
Redis, or Unbound configuration - a healthcheck tweak, an image bump, a volume change -
has to be made twice and can silently drift out of sync (roadmap 5.7).

The same finding also flags a missing spam-scanner-level healthcheck. Investigating
found no heartbeat/health signal anywhere in the app to check against yet - that's
roadmap 5.23 (heartbeat file + generalized failure notifier), a separate,
not-yet-scheduled finding. This change does not add a placeholder or partial
healthcheck for spam-scanner; it documents the dependency on 5.23 instead.

## What Changes

- Extract the shared `rspamd`/`redis`/`unbound`/`networks` block into a new
  `docker-compose.base.yml` at the repo root.
- `docker-compose.yml` becomes an `include:` of `docker-compose.base.yml` plus its
  own `spam-scanner` service - same file, same invocation (`docker compose up -d`),
  same resulting service set.
- `bin/local/docker-compose.yml` becomes an `include:` of `docker-compose.base.yml`
  with no additional services - same file, same invocation
  (`bin/local/rspamd.sh up` / `docker compose --project-directory . -f
  bin/local/docker-compose.yml ...`), same resulting service set (rspamd/redis/unbound,
  no spam-scanner).
- No change to `bin/local/rspamd.sh` - it keeps its existing
  `--project-directory "${PROJECT_ROOT}"` flag, which the chosen include path is
  written to be compatible with (verified empirically - see design.md).
- Does **not** add a spam-scanner healthcheck - no heartbeat signal exists yet to
  check against (roadmap 5.23). Documented as an open dependency, not implemented as
  a placeholder.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

(none - this is a pure de-duplication refactor. `compose-project-isolation`'s
requirements (no hard-coded container names, project-scoped network key, documented
multi-stack usage) are unchanged in observable behavior: verified via `docker compose
config` that both entry points still resolve to the same effective service sets,
default project name (`spam-scanner`), and project-scoped network name
(`spam-scanner_spam-network`) as before the refactor. `skip_specs: true` is set
accordingly.)

## Impact

- New file: `docker-compose.base.yml` (repo root).
- Modified: `docker-compose.yml`, `bin/local/docker-compose.yml`.
- No change to `bin/local/rspamd.sh`, `.env.example`, `README.md`'s documented
  commands, or CI (`.github/workflows/ci.yml` does not reference either compose
  file).
- No change to container/service/network names, so no impact on already-running
  stacks - a plain `docker compose up -d` / `bin/local/rspamd.sh up` on the new files
  reconciles cleanly against existing containers.
