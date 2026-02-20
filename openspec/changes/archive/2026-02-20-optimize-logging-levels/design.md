## Context

The scanner runs in a continuous loop (every N seconds) via `start.sh` / `entrypoint.sh`. The sequence per cycle is: train-spam → train-ham → whitelist → blacklist → scan-inbox. In the vast majority of cycles all training folders and the inbox contain zero new messages, so each workflow opens a folder and immediately returns. Currently every one of those steps emits `.info` logs — folder opens, IMAP searches, "no messages found", per-message Rspamd check start/result, per-message learn calls, flag ops, move ops — producing a continuous flood of output with no signal.

The `rootLogger` system already supports `.debug` — logs at that level are suppressed unless `LOG_LEVEL=debug` is set.

## Goals / Non-Goals

**Goals:**
- Reduce console noise in normal operation so only meaningful events appear at `.info`
- Retain full detail at `.debug` for diagnostic purposes
- Define a clear principle distinguishing `.info` from `.debug` across all components

**Non-Goals:**
- Changing the logger implementation or adding new log levels
- Changing log output format
- Modifying how `LOG_LEVEL` is configured

## Decisions

### Decision: `.info` level = observable outcome, `.debug` level = implementation detail

**Rationale**: An "observable outcome" is something an operator would want to know happened — spam found, training completed, map file changed, folder created. An "implementation detail" is a step taken to produce that outcome — folder opened, IMAP search issued, message fetched, flag operation issued.

**Rule of thumb**:
- Ask "would the absence of this log make debugging harder?" → `.debug`
- Ask "would the absence of this log hide a meaningful system state change?" → `.info`

Alternatives considered:
- Keep all `.info`, add `QUIET_MODE` flag — rejected; complicates config and doesn't compose well
- Move per-message logs to `trace` — rejected; no `trace` level is in active use, `.debug` is sufficient

### Decision: Idle-path "no messages" logs → `.debug`

These fire on every cycle (every N seconds) when nothing is happening. They are the dominant source of noise. Moving them to `.debug` eliminates the flood while still being inspectable when `LOG_LEVEL=debug`.

### Decision: Workflow-level summary logs stay `.info`

Logs like `All scan operations completed`, `All messages processed with rspamd learn`, `${type} map updated` fire only when work actually happened and carry actionable counts. These stay `.info`.

### Decision: Per-message logs → `.debug`

`Starting Rspamd check`, `Rspamd check completed`, `Rspamd scan results`, `Learning message with rspamd`, `Message processed with rspamd learn` — all fire N times per batch. They are superseded by batch-level summaries. Moving to `.debug`.

### Decision: IMAP client operation confirmations → `.debug`

`Opened folder`, `Searching messages`, `Found messages`, `Fetched all messages`, `Fetched messages by UIDs`, `All messages moved`, `Flags added/removed/updated` — these are IMAP driver confirmations. The only exception: `Created folder` (structural change) stays `.info`.

## Risks / Trade-offs

- **Risk**: Operators currently rely on `.info` for specific per-message visibility → Mitigation: `.debug` mode is easily enabled via `LOG_LEVEL=debug`; no information is lost, only suppressed by default
- **Risk**: Missing a log that should stay `.info` → Mitigation: the explicit table in the spec covers every call site; tests validate behavior not log output

## Migration Plan

- Edit each source file; no configuration change required
- No rollback complexity — log level changes are trivially reversible
- Recommended: run with `LOG_LEVEL=debug` after deployment to verify `.debug` logs still appear correctly
