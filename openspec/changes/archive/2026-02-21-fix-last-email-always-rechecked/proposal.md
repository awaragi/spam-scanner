## Why

On every run, the last processed email is always re-scanned. The IMAP UID range query `lastUID+1:*` wraps around when no new messages exist — IMAP interprets `*` as the current max UID, so `7385:7384` becomes `7384:7385`, returning the last known UID. This wastes resources and can trigger repeated (unnecessary) processing on already-handled messages.

## What Changes

- After the IMAP UID search, filter results to discard any UIDs ≤ `state.last_uid`, preventing re-processing of the last seen email when no genuinely new messages are present.

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `scan-inbox`: The UID de-duplication behaviour of the scan workflow changes — results from the IMAP search are now filtered client-side to ensure only UIDs strictly greater than the last processed UID are enqueued for scanning.

## Impact

- `src/lib/workflows/scan-workflow.js` — one-line filter added after `search()` call
- No API, config, or state-format changes required
