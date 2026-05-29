## 1. Extract init-workflow

- [x] 1.1 Create `src/lib/workflows/init-workflow.js` and move folder-creation logic from `src/init-folders.js` into an exported `runInit(imap)` function
- [x] 1.2 Update `src/init-folders.js` to use `newClient()` + connect → `runInit(imap)` → logout pattern, matching all other standalone scripts

## 2. Create orchestrator

- [x] 2.1 Create `src/orchestrator.js` with startup validation — read `config.IMAP_HOST` and `config.IMAP_USER`, log error and `process.exit(1)` if either is missing
- [x] 2.2 Implement `runStep(workflowFn)` helper — opens an IMAP connection, calls `workflowFn(imap)`, closes connection in a `finally` block
- [x] 2.3 Implement the one-time init phase — call `runStep(runInit)` before the poll loop starts
- [x] 2.4 Implement the poll loop — call `runStep` for each workflow in sequence: `runSpam`, `runHam`, `runWhitelist`, `runBlacklist`, `run` (scan)
- [x] 2.5 Implement loop mode: when `SCAN_INTERVAL` is a positive integer, sleep that many seconds between cycles; when `-1` (default), execute one cycle and exit
- [x] 2.6 Log step execution timing: record elapsed time per step and emit `step` + `duration` (ms) fields in the completion log
- [x] 2.7 Add top-level `await` to start execution when the script is run directly

## 3. Update shell scripts

- [x] 3.1 Update `bin/local/start.sh` — remove `run_script()` function, scripts array, and while-loop; replace with `exec node src/orchestrator.js`
- [x] 3.2 Update `bin/docker/entrypoint.sh` — remove `run_script()` function, SCRIPTS loop, and while-loop; replace with `exec node src/orchestrator.js`
- [x] 3.3 Remove startup validation from both shell scripts (IMAP_HOST, IMAP_USER checks) since validation moves to the orchestrator

## 4. Smoke test

- [x] 4.1 Run `bin/local/start.sh <env-file>` locally and confirm init + one full poll cycle completes cleanly
- [x] 4.2 Confirm `node src/init-folders.js` still works as a standalone script
- [x] 4.3 Confirm `node src/train-spam.js` (and other standalone scripts) still work independently
