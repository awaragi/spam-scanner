# Design

## Context

See `proposal.md` - Why. Relevant current state, verified directly against this
machine's Docker Compose (v5.3.0, well above the `include:` directive's 2.20 minimum):

- `docker-compose.yml` (repo root) is invoked as plain `docker compose up -d` from
  the repo root - project-directory defaults to cwd (repo root), so no explicit
  `--project-directory` flag is used for this entry point.
- `bin/local/docker-compose.yml` is invoked only via `bin/local/rspamd.sh`, whose
  `compose()` helper always passes `--project-directory "${PROJECT_ROOT}"` (repo
  root) alongside `-f bin/local/docker-compose.yml`. The file's own header comment
  already documents this as the required invocation and discourages calling it
  directly without `--project-directory`.
- Both entry points currently default their Compose project name to `spam-scanner`
  (derived from the repo root directory name, since both resolve project-directory to
  the repo root) - confirmed via `docker compose config | grep '^name:'` for both.
  This is why `README.md` already instructs setting `COMPOSE_PROJECT_NAME` to run
  both stacks side by side (`compose-project-isolation`'s documented-usage
  requirement), and this change preserves that default rather than changing it.

## Goals / Non-Goals

**Goals:**

- Single source of truth for the rspamd/redis/unbound/network definitions.
- Zero change to how either stack is invoked, named, or networked - verified via
  `docker compose config`, not just read from the diff.

**Non-Goals:**

- Not implementing a spam-scanner healthcheck - no heartbeat signal exists yet
  (roadmap 5.23 owns that). Adding a fake one (e.g. "process is running") would be
  worse than no healthcheck: `depends_on: condition: service_healthy` elsewhere could
  come to falsely rely on it meaning "actually processing mail."
- Not changing `bin/local/rspamd.sh`'s documented invocation pattern or flags.
- Not touching `.env.example`, `README.md`'s command examples, or CI - none reference
  compose-file internals that this change alters.

## Decisions

**Use Compose's `include:` directive (Compose Spec ≥ 2.20) rather than multiple `-f`
flags at the invocation sites.** `include:` lets each entry-point file stay a single
self-contained file that Compose flattens at load time, so `docker compose up -d`
and `bin/local/rspamd.sh up` keep working exactly as documented today with zero
script/doc changes. Alternative considered: drop `bin/local/docker-compose.yml`
entirely and have `bin/local/rspamd.sh` invoke
`docker compose -f docker-compose.base.yml ...` directly - rejected because
`bin/local/docker-compose.yml`'s own file is referenced directly in its header's
documented manual invocation (`-f bin/local/docker-compose.yml`), and keeping a
real file at that path is less disruptive than also rewriting that documented
command.

**Include path is `docker-compose.base.yml` (repo-root-relative) in both files, not
`../../docker-compose.base.yml` from `bin/local/docker-compose.yml`.** Verified
empirically that Compose resolves a relative `include:` path against the *effective
project directory* when one is explicit, not against the including file's own
directory: with `--project-directory .` (repo root) and an include entry of
`../../docker-compose.base.yml`, Compose looked for the file two directories above
the project directory (wrong) rather than two directories above
`bin/local/`. `../../docker-compose.base.yml` only resolves correctly for the
*implicit* default (no `--project-directory`, project-directory falls back to the
including file's own directory). Since `bin/local/rspamd.sh` always passes
`--project-directory "${PROJECT_ROOT}"` (repo root), the include path must be
written relative to *that* - i.e. `docker-compose.base.yml` with no `../../` - and
this is also exactly correct for `docker-compose.yml`'s own default
(project-directory = repo root too, since it's invoked from there). One path spelling
works for both entry points because both resolve project-directory to repo root by
different means.

**No `name:` field added to any compose file.** Compose already derives the same
default (`spam-scanner`) for both entry points today, from project-directory's
basename - unchanged by this refactor. Adding an explicit `name:` was considered as
a way to make the default independent of directory naming, but every file setting
the *same* hardcoded name would make the current `COMPOSE_PROJECT_NAME` override
instructions (documented in `README.md` per `compose-project-isolation`) the only
thing standing between the two stacks and a same-name collision - exactly the
situation that already exists today. Not a regression either way, so left alone as
out of scope for a pure de-dup change.

## Risks / Trade-offs

- [`include:` requires Docker Compose ≥ 2.20 (released 2023); an older Compose
  binary would fail to parse either compose file] → Not a version the project
  documents supporting today (`README.md` just says "Docker Compose v2
  (`docker compose`)" with no minimum), and 2.20 is over two years old at the time of
  this change - judged an acceptable floor to introduce silently. If this becomes a
  real support complaint, document a minimum Compose version in `README.md`
  (prerequisites section) as a follow-up.
- [A user invokes `bin/local/docker-compose.yml` directly with `-f` but without
  `--project-directory`, contrary to the file's own header instructions] → The
  `include:` path (`docker-compose.base.yml`, no `../../`) would fail to resolve
  from `bin/local/`'s own directory, erroring loudly ("file not found") instead of
  today's silent-wrong-relative-paths failure mode for the same unsupported
  invocation. A clearer failure for an already-unsupported usage, not a new one.
- [Spam-scanner healthcheck stays unimplemented] → Tracked as-is under roadmap 5.23;
  not a regression, since no healthcheck exists for that service today either.

## Migration Plan

No data or running-container migration - this only changes how the compose files are
authored, not the resulting service/network/container names or configuration. Both
stacks reconcile cleanly against already-running containers on the next
`docker compose up -d` / `bin/local/rspamd.sh up`. Rollback is a plain revert of the
three file changes.
