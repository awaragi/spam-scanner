#!/usr/bin/env bash
set -euo pipefail

# One-off migration: copies the global rspamd Bayes corpus in Redis to the
# first mailbox's per-user keys, so that mailbox keeps its accumulated
# training history once per-user Bayes is enabled
# (see rspamd/config/classifier-bayes.conf and
# openspec/changes/6-per-user-bayes/design.md, decisions D4/D5).
#
# With `per_user = true` and the default `new_schema = true`, rspamd's Redis
# Bayes key prefix is `%s%l` (global) vs `%s%l%r` (per-user) - i.e. a
# per-user key is the corresponding global key with the mailbox id appended.
# This script therefore COPYs each global key `RS...` to `RS...<MAILBOX_ID>`
# and leaves the original in place: rspamd falls back to the global corpus
# for any request that sends no user (e.g. terminal/, until it is retired),
# so the source MUST be preserved, never moved or deleted.
#
# ============================================================================
# BEFORE RUNNING: back up Redis
# ============================================================================
#   Back up "${SPAM_SCANNER_DATA}/redis/" (the Redis data directory the
#   compose stack mounts - see docker-compose.base.yml) before running this
#   script with --apply. This script only COPYs keys and never deletes
#   anything, but a backup is cheap insurance against a wrong key guess.
#
# Usage:
#   MAILBOX_ID=owner@example.com bin/migrate-bayes-per-user.sh          # dry-run (default, no writes)
#   MAILBOX_ID=owner@example.com bin/migrate-bayes-per-user.sh --apply  # perform the copies
#
# Env vars:
#   MAILBOX_ID  Required. The first mailbox's id (email address) - the same
#               value the server reads as MAILBOX_ID. The migration target.
#   REDIS_CLI   Optional. Overrides how redis-cli is invoked, e.g. to run
#               against a different compose project or a bare redis-cli on
#               PATH. Defaults to "docker compose exec -T redis redis-cli",
#               matching the `redis` service in docker-compose.base.yml.
#
# Safety:
#   - Dry-run by default: prints each planned `key -> key<MAILBOX_ID>` copy
#     and performs NO writes. Only --apply performs them.
#   - Discovery uses `redis-cli --scan`, never `KEYS` (SCAN is safe to run
#     against a live, populated Redis).
#   - Keys that already look per-user (containing "@", i.e. already ending in
#     a mailbox id) are skipped - they're not part of the global corpus.
#   - Copies use Redis COPY only (never RENAME/DEL), so the source is always
#     preserved. If a destination key already exists, COPY (without REPLACE)
#     fails; this script treats that as "already migrated", warns, and skips
#     it - so it is safe to re-run.
#
# This is a one-off operator tool for the per-user-Bayes cutover. It does NOT
# enable per_user itself (that's rspamd/config/classifier-bayes.conf) and
# does NOT restart rspamd. It can be deleted once the cutover is complete.

readonly REDIS_CLI="${REDIS_CLI:-docker compose exec -T redis redis-cli}"

MAILBOX_ID="${MAILBOX_ID:-}"
if [[ -z "$MAILBOX_ID" ]]; then
  echo "Error: MAILBOX_ID is not set." >&2
  echo "Set it to the first mailbox's id (email address), e.g.:" >&2
  echo "  MAILBOX_ID=owner@example.com $0 [--apply]" >&2
  exit 1
fi

APPLY=false
for arg in "$@"; do
  case "$arg" in
    --apply)
      APPLY=true
      ;;
    *)
      echo "Error: unknown argument: $arg" >&2
      echo "Usage: $0 [--apply]" >&2
      exit 1
      ;;
  esac
done

echo "============================================================================"
echo "rspamd Bayes global -> per-user migration"
echo "============================================================================"
echo "Target mailbox (MAILBOX_ID): ${MAILBOX_ID}"
echo "redis-cli command:           ${REDIS_CLI}"
echo
echo "REMINDER: back up \${SPAM_SCANNER_DATA}/redis/ before running with --apply."
echo
if [[ "$APPLY" == "true" ]]; then
  echo "Mode: APPLY - keys will be COPIED (source preserved, nothing deleted)."
else
  echo "Mode: DRY-RUN (default) - no writes will be performed."
  echo "Re-run with --apply once you've reviewed the plan below and backed up Redis."
fi
echo

# Discover global Bayes keys via SCAN (never KEYS, which blocks Redis on a
# large keyspace). `redis-cli --scan --pattern` prints one matching key per
# line and terminates on its own - no cursor/looping needed. Piped through a
# `while read` loop (not `mapfile`, a bash-4+ builtin) to stay portable to
# the older bash shipped on macOS.
PLANNED_COUNT=0
SKIPPED_COUNT=0
FOUND_ANY=false

while IFS= read -r key; do
  # Skip empty lines defensively (e.g. trailing newline from redis-cli).
  [[ -z "$key" ]] && continue
  FOUND_ANY=true

  # Skip keys that already look per-user: the per-user suffix is a mailbox
  # id (an email address), so any key already containing "@" is assumed to
  # already be per-user and is not part of the global corpus to migrate.
  if [[ "$key" == *"@"* ]]; then
    continue
  fi

  dest="${key}${MAILBOX_ID}"
  echo "  ${key} -> ${dest}"
  PLANNED_COUNT=$((PLANNED_COUNT + 1))

  if [[ "$APPLY" == "true" ]]; then
    # COPY without REPLACE fails (non-zero / "0" reply) if dest exists -
    # treat that as "already migrated" and skip, so re-running is safe.
    if ! ${REDIS_CLI} COPY "$key" "$dest" | grep -q '^1$'; then
      echo "    Warning: destination '${dest}' already exists (or COPY failed) - skipped." >&2
      SKIPPED_COUNT=$((SKIPPED_COUNT + 1))
    fi
  fi
done < <(${REDIS_CLI} --scan --pattern 'RS*')

if [[ "$FOUND_ANY" == "false" ]]; then
  echo "No keys matching 'RS*' were found. Nothing to do."
  exit 0
fi

echo
echo "Planned copies: ${PLANNED_COUNT}"
if [[ "$APPLY" == "true" ]]; then
  echo "Skipped (destination already existed): ${SKIPPED_COUNT}"
  echo "Done. The global corpus above was left in place (COPY, not MOVE)."
else
  echo "Dry-run complete - no writes performed. Re-run with --apply to perform the copies."
fi
