# Tasks

## 1. Extract the shared base file

- [x] 1.1 Create `docker-compose.base.yml` at the repo root containing the
      `rspamd`, `redis`, `unbound` services and the `spam-network` network
      definition, copied verbatim from the current (identical) blocks in
      `docker-compose.yml`/`bin/local/docker-compose.yml`, plus a header comment
      explaining it's included by both entry points and not meant to be run
      directly with `-f`.

## 2. Rewire the two entry points

- [x] 2.1 Replace `docker-compose.yml`'s `rspamd`/`redis`/`unbound`/`networks` blocks
      with `include: [docker-compose.base.yml]`, keeping the `spam-scanner` service
      and its `networks: [spam-network]` reference as-is.
- [x] 2.2 Replace `bin/local/docker-compose.yml`'s `rspamd`/`redis`/`unbound`/
      `networks` blocks with `include: [docker-compose.base.yml]`, keeping its
      existing header comment (invocation instructions are unchanged).

## 3. Verify no behavior change

- [x] 3.1 Run `docker compose -f docker-compose.yml config --services` and confirm
      the service list is exactly `rspamd, redis, unbound, spam-scanner` (same as
      before the refactor).
- [x] 3.2 Run `docker compose --project-directory . -f bin/local/docker-compose.yml
      config --services` (the invocation `bin/local/rspamd.sh` actually uses) and
      confirm the service list is exactly `rspamd, redis, unbound` (no
      `spam-scanner`).
- [x] 3.3 For both commands above, additionally run with `config` (no `--services`)
      and confirm: default project name is `spam-scanner` for both, the network
      resolves to `spam-scanner_spam-network` for both, and the `rspamd`/`redis`
      bind-mount source paths resolve to the real repo root / `$SPAM_SCANNER_DATA`
      (not a path relative to `bin/local/`).
- [x] 3.4 Confirm the already-running production stack reconciles cleanly:
      `docker compose -f docker-compose.yml up -d --no-recreate` shows no unwanted
      container recreation purely from this file restructuring. **Result**: the
      live stack currently needs `redis` recreated regardless (its running
      container predates a healthcheck being applied - `docker inspect
      spam-scanner-redis-1` shows `Healthcheck: null`, `Created` 2026-09-20).
      Verified this is pre-existing drift, not caused by this change: re-ran the
      same `--no-recreate` check against `docker-compose.yml` as it existed at
      `HEAD` (before this change) and got the identical "redis has no healthcheck
      configured" dependency error. Not fixed here - out of scope for a pure
      de-dup refactor; left for the user to `docker compose up -d` (recreating
      `redis`, and cascading to `rspamd`/`spam-scanner` via `depends_on`) whenever
      they're ready to accept a brief restart of the production stack.
