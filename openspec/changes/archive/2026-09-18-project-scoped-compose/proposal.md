# Proposal

## Why

Both Compose files (`docker-compose.yml` for production, `bin/local/docker-compose.yml` for dev) hard-code the same `container_name` values (`spam-scanner`, `rspamd`, `rspamd-redis`, `rspamd-unbound`), which defeats Compose's built-in project-name isolation (`-p`/`COMPOSE_PROJECT_NAME`). As a result, a dev stack and a production stack can never both be "up" on the same host — the second `docker compose up` fails with "container name already in use" — and standing up a second independent instance (e.g. one per mailbox, ROADMAP 5.28) requires hand-editing every `container_name`. The two files are also inconsistent about networking: the root file declares an explicit `spam-network`, while `bin/local/docker-compose.yml` declares no network at all and falls onto whatever default Compose derives.

## What Changes

- Remove the `container_name:` overrides from both `docker-compose.yml` and `bin/local/docker-compose.yml` so container names derive from the Compose project name (`<project>-rspamd-1`, etc.).
- Give both files an explicit, identical network name (templated from the project name) instead of only the root file declaring one.
- Document how to run multiple isolated stacks side by side (dev + prod, or multiple mailboxes) via `-p <name>` / `COMPOSE_PROJECT_NAME`, including in `bin/local/rspamd.sh` and `README.md`.
- **BREAKING**: any tooling, aliases, or muscle-memory `docker exec rspamd …` / `docker logs spam-scanner` commands that rely on the fixed container names will need to switch to `docker compose exec rspamd …` / project-qualified names instead.

## Capabilities

### New Capabilities
- `compose-project-isolation`: Compose stacks (root/production and `bin/local` dev) are isolated by Compose project name rather than fixed container/network names, so multiple stacks can coexist on one host.

### Modified Capabilities

_(none — no existing specs describe container naming/network behavior)_

## Impact

- `docker-compose.yml` — remove `container_name:` on all four services; network name templated from project.
- `bin/local/docker-compose.yml` — remove `container_name:` on all three services; add an explicit network matching the root file's naming scheme.
- `bin/local/rspamd.sh` — no functional change required (already uses service names via `docker compose`, not fixed container names), but help text/docs may note `-p`/`COMPOSE_PROJECT_NAME` usage for parallel stacks.
- `README.md` — document coexistence of dev/prod stacks and the multi-instance-per-mailbox pattern (ties into ROADMAP 5.28's near-term recommendation).
