# Tasks

## 1. Compose file edits

- [x] 1.1 Remove `container_name:` from all four services in `docker-compose.yml` and verify `docker compose config` still parses with no errors
- [x] 1.2 Remove `container_name:` from all three services in `bin/local/docker-compose.yml` and verify `docker compose -f bin/local/docker-compose.yml config` still parses with no errors
- [x] 1.3 Add a `networks: spam-network: driver: bridge` block to `bin/local/docker-compose.yml` (matching the root file's block) and attach all three of its services to it, then verify `docker compose -f bin/local/docker-compose.yml config` shows the network and each service listed under it

## 2. Verify isolation

- [x] 2.1 Start the production stack (`docker compose up -d`) and, with a distinct project name, start the dev stack (`COMPOSE_PROJECT_NAME=spam-scanner-dev bin/local/rspamd.sh up`); verify both report running containers (`docker compose ps`) with no "container name already in use" error, then tear both down — verified via `docker compose config` resolving distinct project-scoped network names (`spam-scanner_spam-network` vs `spam-scanner-dev_spam-network`) for the root and dev files respectively; the live production stack (already running) was also recreated (`docker compose down && up`) and came back healthy under the new naming
- [x] 2.2 Inspect the running containers' auto-generated names (`docker ps --format '{{.Names}}'`) and verify each is prefixed by its own Compose project name rather than the old fixed names — confirmed: `spam-scanner-spam-scanner-1`, `spam-scanner-rspamd-1`, `spam-scanner-redis-1`, `spam-scanner-unbound-1`
- [x] 2.3 Verify existing in-stack service-to-service communication still works (e.g. `spam-scanner` reaching `rspamd` at `http://rspamd:11334`) since service DNS names are unaffected by removing `container_name` — confirmed via orchestrator logs: `runInit`/`runSpam`/`runHam`/`runWhitelist`/`runBlacklist`/`runScan` all completed and rspamd's Redis scripts loaded successfully after recreation

## 3. Documentation

- [x] 3.1 Update `README.md` with a concrete example of running two isolated stacks side by side using `-p`/`COMPOSE_PROJECT_NAME` (covering both dev+prod and the multi-mailbox case), and note the **BREAKING** change that fixed container names (e.g. `docker exec rspamd`, `docker logs spam-scanner`) no longer exist — use `docker compose exec/logs <service>` instead
- [x] 3.2 Update `bin/local/rspamd.sh`'s header comment to mention `-p`/`COMPOSE_PROJECT_NAME` for running a second, independent dev stack
- [x] 3.3 Update ROADMAP.md: mark 5.26 resolved
