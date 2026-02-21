## Context

The scan workflow in `src/lib/workflows/scan-workflow.js` tracks the last processed UID in persistent state (`state.last_uid`). On each run it searches for new messages with the IMAP UID range `lastUID+1:*`.

Per the IMAP specification (RFC 3501), `*` in a UID range refers to the largest UID in the mailbox. When `lastUID+1` exceeds the current maximum UID (i.e. no new messages exist), the range `7385:7384` is silently reversed by the server to `7384:7385`, returning UID 7384 — the last already-processed message. This causes one superfluous Rspamd check on every run with no new mail.

## Goals / Non-Goals

**Goals:**
- Ensure the scan workflow skips emails whose UIDs are ≤ `state.last_uid`, even if the IMAP server returns them due to range inversion.
- Zero change to state format, configuration, or external interfaces.

**Non-Goals:**
- Changing the IMAP query itself (the `lastUID+1:*` range is idiomatic and widely used; fixing server-side behaviour is not in scope).
- Addressing any other potential sources of re-processing (e.g. server-side UID renumbering after mailbox compaction).

## Decisions

### Client-side UID filter after search

**Decision:** After calling `search()`, filter the returned UID list with `.filter(uid => uid > state.last_uid)` before processing.

**Rationale:** The IMAP `lastUID+1:*` query is the standard approach and correct for all normal cases. The inversion only occurs at the edge case where `lastUID+1 > maxUID`. A one-line client-side filter is the minimal, non-breaking fix with no risk of regression. Alternatives considered:

| Alternative | Reason rejected |
|---|---|
| Change query to `lastUID:*` and skip the first result | Fragile — assumes the first result is always `lastUID`; breaks with multi-message returns |
| Track `last_uid` as `null` and use `1:*` initially | Wider blast radius; changes initial-state logic unnecessarily |
| Handle at the IMAP client layer in `imap-client.js` | The filter is context-dependent (needs `state.last_uid`); belongs in the workflow |

## Risks / Trade-offs

- **UID renumbering:** Some IMAP servers renumber UIDs after compaction (non-RFC-compliant). The filter would then incorrectly skip legitimately new messages whose UIDs happen to fall below `last_uid`. This is an existing limitation of the UID-based approach and is out of scope. → Mitigation: none required; this pre-existed the fix.
- **Filter silently swallows results:** If the filter discards UIDs for any unexpected reason, messages may be silently skipped. → Mitigation: the existing debug-level log of the raw `search()` results provides traceability.
