# Proposal

## Why

`ai-spam-escalation`'s fail-open design means AI classification failures are silently absorbed — a message just stays in its rspamd bucket and the error is logged. That's correct for a single blip, but if the AI provider is misconfigured or down for an extended period, nobody finds out except by reading logs. The mailbox owner should get a visible signal, in the one place this app already talks to them (their own inbox), without being spammed by a repeat notification for the same ongoing outage.

## What Changes

- Add `AI_FAILURE_ALERT_THRESHOLD` (default `3`, `-1` disables): after this many **consecutive** AI classification failures **of the same normalized reason**, append a plain-text alert message to `INBOX` describing the failure (reason category, consecutive count, last error message, timestamp).
- Add error-reason normalization for AI failures: SDK errors (`openai`'s `APIError` subclasses — timeout, connection, auth, rate-limit, 5xx, etc.) are grouped by their error class; the app's own thrown errors (empty response, invalid JSON, missing `score` field) are grouped by a fixed code rather than their raw (dynamic, response-text-embedding) message. This is what makes "same reason" meaningful — today's raw `err.message` values embed per-response text and would almost never repeat.
- Track a single in-memory "current streak" (`{reason, count, notified}`) for the life of the orchestrator process: a failure matching the active streak's reason increments it; a failure with a different reason starts a new streak (abandoning the old count); any successful classification resets the streak to zero and clears `notified`. This is process-lifetime state, not persisted — it resets on restart, so it's fully meaningful in IDLE/poll (long-running) mode and only accumulates within a single run in the default single-run/cron mode (`SCAN_INTERVAL=-1`).
- Once a streak reaches the threshold, post the alert exactly once (`notified = true`) and suppress further alerts for that same streak; a new streak (different reason, or the same reason recurring after a reset) can alert again. If the INBOX append itself fails, `notified` stays `false` so the next failure retries the post.
- The alert message is a normal new message appended to `INBOX` (left unread) — it is not excluded from the next scan cycle and will itself pass through rspamd/AI like any other new mail (expected to score as clean).
- No change to `ai-spam-escalation`'s fail-open behavior itself: batches still never abort on AI failure, and messages still stay in their original bucket.

## Capabilities

### New Capabilities
- `ai-failure-notification`: consecutive-same-reason AI failure tracking and one-shot INBOX alerting, reset on next success.

### Modified Capabilities
_None._ `ai-spam-escalation`'s fail-open requirement is unchanged (no abort, no bucket change on failure) — this change only adds an observability side effect alongside it. (That capability's spec is still in `openspec/changes/ai-spam-escalation/`, not yet archived to `openspec/specs/`, so there is no archived spec to file a delta against.)

## Impact

- New files: `src/lib/utils/ai-error-reason.js` (error → normalized reason code), `src/lib/services/ai-failure-tracker.js` (in-memory streak state machine), plus matching tests.
- Modified files: `src/lib/services/ai-classification-service.js` (feed each `classifyOne` outcome to the tracker; surface a new-alert signal from `classifyWithAi`), `src/lib/workflows/scan-workflow.js` (append the alert message to `INBOX` via IMAP when a new alert is signaled), `src/lib/clients/imap-client.js` (new small helper to append a plain message to a folder, reusable beyond this feature), `src/lib/utils/config.js` (`AI_FAILURE_ALERT_THRESHOLD`), `.env.example`.
- No new dependencies — reuses the `openai` SDK's existing exported error classes for categorization.
- Only active when `AI_ENABLED=true` (the tracker only ever sees input when AI classification actually runs).
