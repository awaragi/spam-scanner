# Design

## Context

See proposal.md - Why. Two Compose files exist: `docker-compose.yml` (production, four services) and `bin/local/docker-compose.yml` (dev, three services — no `spam-scanner` app container). Both currently pin `container_name:` to the same literal values, and only the root file declares a `networks:` block (`spam-network`, no explicit `name:`, so it's already implicitly namespaced as `<project>_spam-network`). `bin/local/rspamd.sh` invokes Compose via `--project-directory "${PROJECT_ROOT}"` with no `-p`/`COMPOSE_PROJECT_NAME`, so both files, run from the same host without an explicit project name, default to the same project name (the project directory's basename) — meaning today they'd collide on project name too, on top of the fixed container names.

## Goals / Non-Goals

**Goals:**
- Two stacks (any combination of prod/dev/per-mailbox) can be "up" at once on one host, given distinct `-p`/`COMPOSE_PROJECT_NAME` values.
- Both compose files behave consistently with respect to networking.
- No change to service names (`spam-scanner`, `rspamd`, `redis`, `unbound`) or how scripts invoke `docker compose <subcommand> <service>` — those already use service names, not container names.

**Non-Goals:**
- Changing the multi-account-in-one-process design (ROADMAP 5.28 item 2) — this only unblocks the multi-instance pattern (5.28 item 1).
- A `bin/setup-env.sh` bootstrap script (ROADMAP 5.27) — separate change.
- Publishing images or an `install.sh` wizard (ROADMAP 7.3.x).

## Decisions

### 1. Drop `container_name:` entirely rather than templating it from a var

**Decision:** Remove the `container_name:` line from every service in both files. Let Compose derive `<project>-<service>-1`.

**Alternatives considered:**
- Template `container_name: ${COMPOSE_PROJECT_NAME:-spam-scanner}-rspamd` — keeps human-friendly fixed names when no project override is given, but still collides the moment two stacks share the default project name (the common case: two clones of the same repo, or dev+prod in the same checkout, both fall back to the same default). Removing the override entirely is the only option that isolates by default, which is the actual goal (5.28 depends on out-of-the-box isolation, not opt-in isolation an operator has to remember).
- Operators who want a stable name for `docker logs`/`docker exec` get one anyway: `docker compose -p <name> logs rspamd` and `docker compose -p <name> exec rspamd sh` work without needing to know the container name.

### 2. Network: add the same *implicit* (project-scoped) network to `bin/local/docker-compose.yml`, not a hard-coded `name:`

**Decision:** Add a `networks: spam-network: driver: bridge` block to `bin/local/docker-compose.yml`, matching the root file's block verbatim (same key, no explicit `name:`). Both therefore get a network Compose namespaces as `<project>_spam-network`, consistent with the container-naming fix.

**Rationale / deviation from ROADMAP wording:** ROADMAP 5.26 suggests "give the network an explicit `name:`". A literal `name:` pins the network to that exact string across *every* project, which is the opposite of isolation — two stacks under different project names would still be forced onto one shared network and could reach each other's containers, and the second `docker compose up` would silently attach to a network created by the first stack instead of failing loudly or being independent. Since the goal is "dev and prod (or two mailboxes) coexist independently," an implicit, project-scoped network name is the correct choice; explicit `name:` is reserved for the opposite use case (deliberately sharing one network across projects), which nothing here calls for.

### 3. No code changes to `bin/local/rspamd.sh`

**Decision:** The script already calls `docker compose ... up/down/logs` using service names and `--project-directory`, never a fixed container name — it needs no source change for correctness. Only its header comment / `README.md` gain documentation of `-p`/`COMPOSE_PROJECT_NAME` usage for running parallel stacks.

## Risks / Trade-offs

- **Muscle memory / external tooling referencing fixed container names** (`docker logs rspamd`, `docker exec -it spam-scanner sh`) breaks → Mitigate by documenting the `docker compose exec/logs <service>` replacement in README; call out as **BREAKING** in the proposal.
- **Existing running containers keep their old fixed names until recreated** → `docker compose up -d` after this change will recreate them under the new naming scheme; no data loss since state lives in bind-mounted `${SPAM_SCANNER_DATA}` (per `rspamd-external-storage`), not in the container itself.
- **Two stacks started with the *same* default project name still collide** (e.g., two `git clone`s of this repo in differently-named directories that happen to share a basename, or nobody passes `-p`) → Out of scope to prevent entirely; documentation explicitly tells operators running more than one stack to pass distinct `-p`/`COMPOSE_PROJECT_NAME` values.

## Migration Plan

1. Edit both compose files: remove `container_name:` lines; add matching `networks: spam-network:` block to `bin/local/docker-compose.yml`.
2. Update `README.md` (and `bin/local/rspamd.sh` header comment) with a documented example for running two stacks concurrently via `-p`.
3. Operators with a running stack: `docker compose down` then `docker compose up -d` (or `bin/local/rspamd.sh down && bin/local/rspamd.sh up`) to recreate containers under the new names. No data migration needed (state is external per `rspamd-external-storage`).

**Rollback:** Revert the compose file edits; re-add `container_name:` lines if needed.
