## Context

The orchestrator currently supports two execution modes controlled by `SCAN_INTERVAL`: single-run (`-1`) and poll-every-N-seconds (positive integer). Each mode runs the same step sequence — train-spam, train-ham, train-whitelist, train-blacklist, scan-inbox — with each step opening and closing its own IMAP connection. The previous javascript-orchestrator change explicitly scoped out IDLE and noted it as the natural next step.

IMAP IDLE (RFC 2177) allows a connected client to ask the server to send unsolicited notifications when mailbox state changes. The server sends an untagged EXISTS response when new messages arrive, which ImapFlow surfaces as a resolved `idle()` promise. This enables event-driven scanning instead of fixed-interval polling.

## Goals / Non-Goals

**Goals:**
- Add `SCAN_INTERVAL=0` as a third orchestration mode: IDLE-driven scan cycles
- Isolate the IDLE connection lifecycle in a dedicated workflow file
- Implement a scan drain loop so all pending messages are processed before re-entering IDLE
- Implement reconnection with configurable retry limit and exponential backoff

**Non-Goals:**
- Parallelising training and scanning (sequence remains strictly serial)
- Multi-folder IDLE (monitoring training folders for immediate re-training)
- Automatic fallback to poll mode if the server does not support IDLE
- Changing the logic of existing train or scan workflows beyond the return value of `run()`

## Decisions

### SCAN_INTERVAL=0 as the IDLE mode indicator

Overloading `SCAN_INTERVAL` rather than adding a new env var (`IDLE_MODE=true` or similar).

**Rationale:** `SCAN_INTERVAL` already owns the question "how does the orchestrator trigger cycles?" Zero is a natural extension: `-1` = once, `0` = event-driven, `N` = every N seconds. No new variable to document or validate.

**Alternative considered:** `IDLE_MODE=true` boolean flag — rejected because it creates a second dimension of configuration that could conflict with `SCAN_INTERVAL` (e.g. what does `SCAN_INTERVAL=300` + `IDLE_MODE=true` mean?).

### IDLE connection lifecycle isolated in idle-workflow.js

A new `src/lib/workflows/idle-workflow.js` encapsulates: open connection → select inbox (read-only) → `imap.idle()` → close connection. The orchestrator calls it as an opaque async function.

**Rationale:** Consistent with the existing pattern where each workflow owns its IMAP interaction. Keeps reconnection logic in the orchestrator (which already owns error handling) rather than in the workflow (which should be a pure operation).

**Alternative considered:** Inline IDLE logic in `orchestrator.js` — rejected because it mixes connection lifecycle with retry orchestration in one large function.

### Coupled training — training runs on every cycle trigger

Training steps run before every scan cycle regardless of trigger (poll tick or IDLE wakeup). No separate training interval.

**Rationale:** Training workflows are no-ops when their folders are empty (UID search returns nothing, step completes in milliseconds). The drain loop means a burst of emails causes only one training run, not one per email. Coupling eliminates the need for a second timer, a `Promise.race`, or an absolute-timestamp check.

**Alternative considered:** Decoupled `TRAIN_INTERVAL` with `Promise.race` — explored and rejected during design. Adds significant orchestration complexity for marginal benefit.

### Scan drain loop driven by processed count

After an IDLE wakeup, the orchestrator calls `runStep(runScan)` in a loop until it returns `{ processed: 0 }`. The scan workflow `run()` is changed from void to returning `{ processed: number }`.

**Rationale:** Catches messages that arrive during the processing of a previous batch. Without the drain loop, a burst of arrivals would be split across separate IDLE wakeups.

**Alternative considered:** Single scan pass per IDLE wakeup — simpler but misses messages that arrive during the scan window.

### Reconnection at orchestrator level, not in idle-workflow.js

The orchestrator wraps the entire IDLE cycle (idle-workflow call + full step sequence) in a retry loop. `idle-workflow.js` does not retry internally — it either succeeds or throws.

**Rationale:** The retry counter needs to span the full cycle, including the processing phase. An error during scanning after a successful IDLE wakeup should count as a failure and trigger backoff. Putting retry logic in the workflow would only cover the connection phase.

**Retry counter reset:** The counter resets to zero after any successful IDLE cycle completes (idle resolves cleanly AND the full step sequence runs without error).

**Backoff:** Exponential — `min(2^retries * 1000ms, 60000ms)`. Caps at 60 seconds to avoid indefinite dormancy after transient failures.

## Risks / Trade-offs

- **Server does not support IDLE** → `imap.idle()` will reject or time out. Caught by the reconnection wrapper, exhausts retries, process exits. No silent degradation.
- **Messages arrive during the work phase** → The IDLE connection is closed while training and scanning run. Messages arriving in this window are caught by the drain loop (scan searches by UID > last_uid, so they appear in the next scan pass).
- **Drain loop runs indefinitely under sustained load** → If messages arrive faster than they can be processed, the drain never converges. Accepted: the server will stop accepting new email long before this becomes a problem.
- **Training runs on every IDLE wakeup** → Adds 4 IMAP round-trips per wakeup even when nothing has changed. Accepted: each is a fast UID search returning an empty result set.

## Migration Plan

- `SCAN_INTERVAL` values of `-1` and positive integers are unchanged — existing deployments are unaffected
- To enable IDLE mode, set `SCAN_INTERVAL=0` in the environment
- `IDLE_MAX_RETRIES` defaults to `5` if not set — no action required for existing deployments
- No data migration, no schema changes, no rollback procedure needed
