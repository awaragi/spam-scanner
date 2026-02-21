## Why

The execution loop (init-folders once, then cycle through train-spam → train-ham → train-whitelist → train-blacklist → scan-inbox with a sleep interval) is currently duplicated across two shell scripts (`bin/local/start.sh` and `bin/docker/entrypoint.sh`). Moving this logic to JavaScript gives us type-safe step definitions that can later be triggered individually by IMAP IDLE events, instead of only running as a fixed poll loop.

## What Changes

- Extract `init-folders` logic into `src/lib/workflows/init-workflow.js` — a proper workflow function (`runInit(imap)`) following the same pattern as `train-workflow.js` and `scan-workflow.js`
- Update `src/init-folders.js` to call the new workflow function (open connection → `runInit(imap)` → close connection), consistent with all other standalone scripts
- Add `src/orchestrator.js` — a JavaScript module that owns the step sequence, the init-once phase, and the poll loop; for each step it opens an IMAP connection, calls the workflow function, and closes the connection
- Reduce `bin/local/start.sh` to a thin wrapper: load `.env`, validate required vars, then delegate to `node src/orchestrator.js`
- Reduce `bin/docker/entrypoint.sh` to a thin wrapper: validate required vars (already injected by Docker), then delegate to `node src/orchestrator.js`
- The individual `src/init-folders.js`, `src/train-*.js`, and `src/scan-inbox.js` scripts remain as standalone CLI entry points

## Capabilities

### New Capabilities
- `orchestration`: JavaScript orchestrator that manages step sequencing, the one-time init phase, the poll loop, and sleep interval — with each step exposed as a named export to support future event-driven (IMAP IDLE) invocation

### Modified Capabilities
<!-- No spec-level requirement changes needed. The scan-inbox, logging, and rspamd-external-storage requirements are unchanged; only who calls them changes. -->

## Impact

- `src/lib/workflows/init-workflow.js`: new file — extracts folder-creation logic from `src/init-folders.js` into an exported `runInit(imap)` function
- `src/init-folders.js`: updated to use `runInit` from `init-workflow.js` (same open/run/close pattern as all other standalone scripts)
- `src/orchestrator.js`: new file — imports workflow functions from `src/lib/workflows/`, defines named steps, runs init-once then poll loop with `SCAN_INTERVAL` sleep
- `bin/local/start.sh`: stripped to env loading + validation + `exec node src/orchestrator.js`
- `bin/docker/entrypoint.sh`: stripped to env validation + `exec node src/orchestrator.js`
- `src/train-*.js`, `src/scan-inbox.js`: unchanged as standalone scripts
- No changes to IMAP client, rspamd client, or existing workflow files
