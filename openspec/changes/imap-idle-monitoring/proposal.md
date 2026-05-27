## Why

The orchestrator currently uses a fixed poll interval (`SCAN_INTERVAL`) to trigger scan cycles — typically every few minutes. This means new emails sit unprocessed until the next poll fires. IMAP IDLE allows the server to push a notification the moment a new message arrives, enabling near-instant scanning with no wasted poll cycles.

The javascript-orchestrator change explicitly noted IDLE as the natural next step: _"individual steps exposed as named exports to support future event-driven (IMAP IDLE) invocation"_.

## What Changes

- Add `SCAN_INTERVAL=0` as a new mode: **IDLE mode** — instead of polling, the orchestrator opens a dedicated IMAP connection on the inbox, enters IDLE, and wakes on server EXISTS notification
- In IDLE mode, the scan cycle is **triggered by the server** rather than a sleep timer; all other behaviour (training before scan, scan drain loop, state tracking via `last_uid`) is unchanged
- The existing `SCAN_INTERVAL=-1` (single run) and `SCAN_INTERVAL=N` (poll) modes are unchanged
- Add a **scan drain loop**: after an IDLE wakeup, the orchestrator scans repeatedly until no new messages remain, then re-enters IDLE — ensuring messages that arrived during processing are also caught
- Add IDLE **reconnection with retry**: if the IDLE connection drops, the orchestrator retries up to `IDLE_MAX_RETRIES` times with exponential backoff; the counter resets on any successful IDLE cycle; if all retries are exhausted, the process exits with a non-zero status
- `runScan` (the scan workflow) returns the count of messages processed so the orchestrator can drive the drain loop

## Training

Training remains **coupled to scanning** — the same train → scan sequence runs on every cycle regardless of what triggered it (poll tick or IDLE wakeup). Since training steps are no-ops when their folders are empty, there is no meaningful cost to running them on each wakeup.

## Configuration

| Variable | Values | Meaning |
|---|---|---|
| `SCAN_INTERVAL` | `-1` | Single run: train once + scan once + exit |
| `SCAN_INTERVAL` | `0` | **IDLE mode**: train + scan drain on each server notification |
| `SCAN_INTERVAL` | `N > 0` | Poll mode: train + scan every N seconds |
| `IDLE_MAX_RETRIES` | integer (default `5`) | Max reconnection attempts before fatal exit (IDLE mode only) |

## Capabilities

### Modified Capabilities
- `orchestration`: extend the orchestrator with IDLE mode — `SCAN_INTERVAL=0` enters a persistent IDLE watch loop with reconnect logic and drain-until-empty scan behaviour; `SCAN_INTERVAL=-1` and `SCAN_INTERVAL=N` modes unchanged
- `scan-inbox`: `run()` returns the count of messages processed (was void) to enable the drain loop in the orchestrator

### New Files
- `src/lib/workflows/idle-workflow.js`: encapsulates the IDLE connection lifecycle — open connection, select inbox, call `imap.idle()`, close on wakeup or error

## Impact

- `src/orchestrator.js`: add IDLE mode branch — when `SCAN_INTERVAL=0`, run the init phase then enter the IDLE loop (reconnect wrapper → open idle connection → `await idle()` → close → run full cycle → repeat)
- `src/lib/workflows/idle-workflow.js`: new file — wraps `newClient()` + `mailboxOpen(INBOX)` + `imap.idle()` + `logout()`
- `src/lib/workflows/scan-workflow.js`: `run()` returns `{ processed: number }` instead of void
- No changes to training workflows, IMAP client, rspamd client, state manager, or shell scripts
- `SCAN_INTERVAL=0` is a new valid value; existing deployments using `-1` or `N > 0` are unaffected
