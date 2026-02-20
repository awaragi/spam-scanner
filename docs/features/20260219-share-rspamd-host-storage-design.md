---
title: Share Rspamd Host Storage Between Compose Environments
date: 2026-02-19
status: draft
---

**Overview**

This design describes how to make the `rspamd` data and maps directories live on the host and be shared consistently between the root `docker-compose.yml` and `rspamd/docker-compose.yml` used for local development. The goal is to provide absolute, easily-backupable host paths (outside the project) configurable via `.env` so both compose files and local scripts (`bin/local/start.sh`) use the same storage locations.

**Success Criteria**

- Both compose files mount the same host directories for persistent `rspamd` storage and maps.
- The host paths are configurable via `.env` entries and default to the agreed absolute base.
- `maps` are readable/writable by the services that need them and are visible to the root compose services that use them.
- The layout works for local dev (`bin/local/start.sh`) and docker modes with minimal changes.
- Backup/restore of `rspamd` data + maps is straightforward (host path contains all files to persist).

**Requirements**

- Functional
  - Use host directories (absolute paths) for persistent storage and maps.
  - Expose those host paths to both the root compose and `rspamd/docker-compose.yml` via `.env` variables.
  - Ensure file ownership and permissions are handled so containers can read/write maps and data.
  - Local `start.sh` should be able to operate using the same host layout (either by reading `.env` or using the same default paths).

- Non-functional
  - Keep configuration simple and explicit (avoid implicit paths inside images).
  - Avoid committing secrets or machine-specific paths into git.
  - Maintain compatibility with macOS Docker Desktop and Linux hosts.

**Proposed Defaults**

- Use an absolute, user-owned base directory on the host. For now the user selected the project rspamd folder as the base: `/Users/pierre/Develop/Projects/spam-scanner/rspamd`
- Expose these `.env` entries (examples):
  - `RSPAMD_HOST_DIR=/Users/pierre/Develop/Projects/spam-scanner/rspamd`
  - `RSPAMD_DATA_DIR=${RSPAMD_HOST_DIR}/data`
  - `RSPAMD_MAPS_DIR=${RSPAMD_HOST_DIR}/maps`

Notes: Using a single `RSPAMD_HOST_DIR` reduces duplication and makes it easy to move the whole storage by changing one variable.

**Design Decisions**

1. Environment-driven host paths
   - Require a small set of `.env` variables in project root that all compose files load via `env_file: .env` or `env_file` at the service level.
   - The root `docker-compose.yml` and `rspamd/docker-compose.yml` will reference the same variables so they mount the identical host directories.

2. Directory layout
   - Host layout (recommended):
     - `${RSPAMD_HOST_DIR}/config` — any custom rspamd configuration overrides
     - `${RSPAMD_HOST_DIR}/data` — runtime data, persistent DBs, worker state
     - `${RSPAMD_HOST_DIR}/maps` — multimap files, whitelist/blacklist maps used by other services

3. Container mountpoints
   - Map host `maps` into the rspamd container path expected by the image (recommendation: `/var/lib/rspamd/maps` or `/rspamd/maps` — confirm current container image path and adjust in the plan).
   - Mount `data` into the container path used for persistent state (e.g. `/var/lib/rspamd` or the image-specific path).

4. Root compose access to maps
   - If the root compose needs to read maps (for training, scanning, or preprocessing), it should either mount the same host `maps` directory into the relevant service, or, if the service expects maps at a different path, mount and map appropriately.

5. Local dev compatibility (`bin/local/start.sh`)
   - Make `start.sh` read `.env` (or accept `RSPAMD_HOST_DIR`) so it can work with the host folders outside the repo.
   - Alternatively, create small wrapper that symlinks `${RSPAMD_HOST_DIR}` into the project when running in local dev.

6. Ownership & Permissions
   - Containers often run as a fixed uid/gid. The design will document the expected UID/GID used by the rspamd image and instruct creating the host dirs and adjusting ownership (or using `--user` / `chown` during container startup) so the container can write to them.
   - For Linux systems with SELinux, the plan will include guidance to add `:z` or `:Z` mount options when required.

**Risks & Considerations**

- macOS specifics: Docker Desktop translates host paths — performance of heavy file I/O in mounted host directories on macOS can be poor. Document expected tradeoffs and suggest using Docker named volumes if performance becomes an issue.
- Image path assumptions: Different rspamd images place config and maps in different paths. The implementation plan must confirm the correct container paths before editing compose files.
- Permissions: On macOS, UID/GID mapping differs; tests should confirm containers can write the mounted directories. We should include a small verification step in the plan.
- Backups: Document backup strategy (which directories to backup). Recommend backing up `${RSPAMD_HOST_DIR}/data` and `${RSPAMD_HOST_DIR}/maps`.

**Acceptance Tests / Validation**

- With `.env` set and host directories present, starting the root `docker-compose up` mounts the maps directory and the service reading maps can access expected files.
- Starting `rspamd/docker-compose up` mounts the same host directories and rspamd can serve the same maps and persist data across restarts.
- Running `bin/local/start.sh` in local dev mode uses the same host directory and can read/write maps and data.

**Next steps (plan will be created after design approval)**

1. Confirm container paths used by the rspamd image(s) in `rspamd/docker-compose.yml` and root services.
2. Add `.env` with `RSPAMD_HOST_DIR` and derived vars; do not commit secrets or machine-specific overrides.
3. Update `docker-compose.yml` (root) and `rspamd/docker-compose.yml` to mount the host dirs using the variables.
4. Add `bin/local/start.sh` changes (or wrapper) for `.env` consumption.
5. Add README instructions covering setup, ownership commands, backup steps, and troubleshooting.

Save location: docs/features/20260219-share-rspamd-host-storage-design.md
