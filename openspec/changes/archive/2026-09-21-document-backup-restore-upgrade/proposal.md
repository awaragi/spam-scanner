# Proposal

## Why

`README.md`'s existing "Backup & Restore" section (verified: lines 526-551) already
covers what to back up and has manual commands - the roadmap's original description
of it ("no dedicated backup/restore tooling yet") is about tooling, and the section
itself is more complete than that phrasing suggests. Two real gaps remain: the
`redis-cli BGSAVE` snapshot-consistency guidance doesn't say how to know the
snapshot actually finished before tarring the data directory (a `tar` that starts
mid-`BGSAVE` can capture a half-written RDB file), and there is no "Upgrading"
section at all - no guidance on bumping the pinned `rspamd`/`redis` image versions,
what to check before doing so, or how to upgrade the `spam-scanner` image itself.

## What Changes

- Tighten the Redis snapshot guidance: wait for `BGSAVE` to actually finish (poll
  `redis-cli INFO persistence`'s `rdb_bgsave_in_progress`) before tarring, instead
  of firing `BGSAVE` and immediately tarring.
- Add an "Upgrading" section to `README.md`: back up first (link to the Backup &
  Restore section above it); how to bump `docker-compose.base.yml`'s pinned
  `rspamd`/`redis` versions (check each project's release notes for breaking
  changes first, especially Bayes/classifier config compatibility for `rspamd`);
  how to rebuild/pull and restart `spam-scanner` itself, given it has no published
  image or version tag yet (roadmap 4.15/6.20/6.21 - out of scope here); a rollback
  note (restore the backup taken beforehand).
- Does **not** add `bin/backup.sh`/`bin/restore.sh` scripts - the roadmap's own
  finding lists only `README.md` under "Where", and dedicated backup/restore
  tooling is separately tracked under roadmap 7.3.5 ("Day-2 helpers"), which
  depends on infrastructure (published images, an `install.sh` wizard) this change
  doesn't touch. Scripting it now would duplicate that later, better-scoped work.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

(none - pure documentation change, no code or spec-level behavior changes;
`skip_specs: true` set accordingly)

## Impact

- `README.md` only.
