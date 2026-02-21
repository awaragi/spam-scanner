## Context

Currently, two shell scripts dupicate the execution loop:
- `bin/local/start.sh` — loads `.env`, validates config, runs `node src/<script>.js` for each step via subprocess
- `bin/docker/entrypoint.sh` — validates injected env, runs `node src/<script>.js` for each step via subprocess

Each step is an independent Node.js process. The shell scripts own the sequence, the init-once phase, and the sleep interval. Any future trigger model (e.g. IMAP IDLE firing specific steps on demand) would require duplicating or circumventing this shell-level logic.

## Goals / Non-Goals

**Goals:**
- Move execution sequencing, init-once phase, and poll loop into `src/orchestrator.js`
- Reduce shell scripts to thin entry points (env loading/validation + `exec node src/orchestrator.js`)
- Keep existing standalone scripts (`src/train-*.js`, `src/scan-inbox.js`) working unchanged as direct CLI entry points

**Non-Goals:**
- Implementing IMAP IDLE monitoring (out of scope — orchestrator just prepares for it)
- Changing the logic of existing workflows in `src/lib/workflows/` (train, scan)
- Parallelising steps (sequence remains strictly serial)
- Adding retry or back-off logic to individual steps

## Decisions

### Step isolation: one IMAP connection per step invocation

Each named step function opens its own IMAP connection, runs its workflow, and closes it — identical to the existing standalone script pattern. This applies uniformly to all steps including init-folders.

**Rationale:** Keeps each step independently callable (e.g. by a future IMAP IDLE handler). A shared connection held open across all steps would require complex state management and reconnect logic for no benefit at this stage.

**Alternative considered:** Single persistent IMAP connection shared across the loop. Rejected because long-lived connections add reconnect complexity and IMAP servers may drop idle connections between steps.

### init-folders: extract to workflow, align with other steps

The folder-creation logic currently embedded in `src/init-folders.js` is extracted into `src/lib/workflows/init-workflow.js` as an exported `runInit(imap)` function. `src/init-folders.js` is then reduced to the same open/run/close pattern as all other standalone scripts.

**Rationale:** The orchestrator manages all steps uniformly — it should not treat init as a special case with inline logic. Extracting it to a workflow means the orchestrator imports and calls `runInit` exactly like `runSpam`, `runHam`, etc. The standalone `src/init-folders.js` script also benefits: it becomes consistent with its siblings.

**Alternative considered:** Keep init logic inline in the orchestrator's `runInitFolders()` step function. Rejected because it breaks the uniform pattern and makes `src/init-folders.js` the only standalone script without an underlying workflow.

### Orchestrator is a plain entry point, not a library

`src/orchestrator.js` is a top-level script (like all other `src/*.js` scripts). It is not exported or imported by anything else. It uses `await` at the top level to run the poll loop directly. Shell scripts become `exec node src/orchestrator.js`.

For each step, the orchestrator opens an IMAP connection, calls the appropriate workflow function, and closes the connection — the same open/run/close pattern the standalone scripts use today. No step wrapper functions are exported.

**Rationale:** Future consumers (e.g. an IMAP IDLE handler) will manage their own connections and call workflow functions from `src/lib/workflows/` directly. There is no benefit to exporting connection-wrapping functions from the orchestrator — it would just be an indirection layer with no reuse value today.

### Sleep mechanism: `setTimeout`-based promise

```js
await new Promise(resolve => setTimeout(resolve, intervalMs));
```

No extra dependency needed. `SCAN_INTERVAL` env var (default 300) drives `intervalMs`, same as today.

**Note:** `start.sh` currently allows pressing Enter to skip the sleep (via `read -t`). This interactive feature is dropped — it was a convenience for manual local runs that becomes irrelevant once a JavaScript loop is running. Documented as a known trade-off.

### Shell scripts: `.env` loading stays in shell, validation moves to orchestrator

`start.sh` keeps the `load_env()` function (shell is the right place to export vars into the Node process environment). Required-var validation (`IMAP_HOST`, `IMAP_USER`) moves into `src/orchestrator.js` startup, using the existing `config` object, so validation is consistent between local and Docker modes.

## Risks / Trade-offs

- **Loss of Enter-to-skip-sleep in local mode** → Acceptable. Can be re-introduced later with a signal handler (`SIGUSR1`) if needed.
- **Orchestrator crash exits the process** → Same behaviour as today (shell loop re-starts on unhandled error in entrypoint). The `set -e` in `entrypoint.sh` ensures the container restarts via Docker's restart policy.
- **Standalone scripts remain thin wrappers** → They continue to work as `node src/train-spam.js` but call the same underlying workflow functions. If the orchestrator's step functions are later refactored (e.g. step takes a shared IMAP client), the standalone scripts would need updating too. Acceptable trade-off for now.

## Migration Plan

1. Add `src/lib/workflows/init-workflow.js` — export `runInit(imap)` with the folder-creation logic from `src/init-folders.js`
2. Update `src/init-folders.js` — replace inline logic with open connection → `runInit(imap)` → close connection
3. Add `src/orchestrator.js` with named step exports and `run()` loop
4. Update `bin/local/start.sh` — remove `run_script()`, scripts array, and while-loop; replace with `exec node src/orchestrator.js`
5. Update `bin/docker/entrypoint.sh` — same reduction; replace SCRIPTS loop with `exec node src/orchestrator.js`
6. Manual smoke test: run `bin/local/start.sh <env-file>` locally and confirm one full cycle completes
7. Docker smoke test: `docker-compose up` and confirm container cycles correctly

Rollback: revert the two shell scripts and `src/init-folders.js`; delete `src/orchestrator.js` and `src/lib/workflows/init-workflow.js`.
