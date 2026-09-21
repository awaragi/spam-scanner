# Tasks

## 1. Tighten backup guidance

- [x] 1.1 In `README.md`'s "Backup & Restore" section, replace the "or use
      `redis-cli BGSAVE` first" parenthetical with a snippet that fires `BGSAVE`
      via `docker compose exec redis redis-cli BGSAVE` and then polls
      `redis-cli INFO persistence` for `rdb_bgsave_in_progress:0` before tarring,
      so the tar can't start mid-snapshot.

## 2. Add an Upgrading section

- [x] 2.1 Add a new `## Upgrading` section to `README.md` (after "Backup &
      Restore"): back up first (link to that section); how to bump the pinned
      `rspamd`/`redis` versions in `docker-compose.base.yml` (check each
      project's release notes first - call out that a major `rspamd` version
      bump can change Bayes/classifier config compatibility); `docker compose
      pull && docker compose up -d` to apply; how to update `spam-scanner`
      itself given it has no published image/version tag yet (`git pull` +
      `docker compose up -d --build`); a rollback note pointing back at the
      backup just taken.
- [x] 2.2 Add the new section to `README.md`'s table of contents / nearest
      existing heading list, if one exists (check first). **N/A**: `README.md` has
      no table of contents or heading index anywhere in the file (verified via
      `grep -n "^## "`) - nothing to update.

## 3. Verification

- [x] 3.1 Run `npm run format:check` and confirm it passes (README.md is
      Prettier-formatted like the rest of the repo).
- [x] 3.2 Read the full updated "Backup & Restore" + "Upgrading" sections back to
      confirm every command is copy-pasteable and self-consistent with the rest of
      the doc (service names, `SPAM_SCANNER_DATA`, image tags referenced actually
      match `docker-compose.base.yml`/`docker-compose.yml`).
