## Why

In continuous mode (`start.sh` / `entrypoint.sh`), the scanner loops constantly. Most cycles process zero messages, yet the current logging emits `.info` for every IMAP folder open, search, and "no messages found" event, producing a wall of noise that makes it hard to spot meaningful output. Reducing log verbosity to `.debug` for routine operational detail will make the console output actionable.

## What Changes

- Demote per-message log calls (Rspamd check start/result, rspamd learn per-message) from `.info` to `.debug`
- Demote IMAP client low-level confirmations (folder opened, messages fetched, moved, flags updated) from `.info` to `.debug`
- Demote idle-path "no messages" events in all workflows from `.info` to `.debug`
- Demote intra-batch progress logs (`Scanning batch`, `Learn batch`, `Moving spam messages`) from `.info` to `.debug`
- Demote processor strategy announcement logs and per-category count logs from `.info` to `.debug`
- Demote map/state backup implementation detail logs from `.info` to `.debug`
- Retain `.info` for meaningful state changes: top-level batch/workflow summaries, actual file writes, folder creation, startup events, and all errors/warnings

## Capabilities

### New Capabilities

- `logging-levels`: Log level assignments across all scanner components — which events log at `.info` vs `.debug` in continuous operation mode

### Modified Capabilities

<!-- No existing spec-level requirements are changing — this is an implementation detail. -->

## Impact

- `src/lib/workflows/scan-workflow.js` — idle path and intra-batch `.info` → `.debug`
- `src/lib/workflows/train-workflow.js` — idle path and batch progress `.info` → `.debug`
- `src/lib/workflows/map-workflow.js` — idle path, state backup, and move confirmation `.info` → `.debug`
- `src/lib/clients/imap-client.js` — folder open, search, fetch, move, flag operations `.info` → `.debug`
- `src/lib/services/message-service.js` — per-message Rspamd check logs `.info` → `.debug`
- `src/lib/services/training-service.js` — per-message learn logs `.info` → `.debug`
- `src/lib/processors/label-processor.js` — strategy announcement and per-category count logs `.info` → `.debug`
- `src/lib/processors/folder-processor.js` — strategy announcement and per-category move logs `.info` → `.debug`
- `src/lib/utils/rspamd-maps.js` — `Rspamd learn skipped` `.info` → `.debug` (in rspamd-client.js)
- `src/lib/clients/rspamd-client.js` — learn skipped `.info` → `.debug`
- `src/lib/utils/email.js` — address rejection `.info` → `.debug`
- `src/init-folders.js` — processing mode config detail `.info` → `.debug`
