# Design

## Context

`classifyOne()` in `src/lib/services/ai-classification-service.js` is the sole place AI classification failures surface: it catches everything `classifyEmail()` (`src/lib/clients/ai-client.js`) throws, logs it, and returns `aiInfo.error`. `classifyWithAi()` fans this out over a batch via `mapWithConcurrency()` (bounded by `AI_CONCURRENCY`) and is called once per `scanBatch()` in `src/lib/workflows/scan-workflow.js`, which holds the IMAP connection and already writes to IMAP (scanner state, message moves/labels). See `proposal.md` for motivation and `specs/ai-failure-notification/spec.md` for the behavioral contract.

## Goals / Non-Goals

**Goals:**
- Decide where the failure-reason categorization lives and what taxonomy it uses.
- Decide where the streak state lives and how it's threaded from `classifyOne`'s per-message outcome up to the IMAP append.
- Decide the alert message's transport (how it gets appended to `INBOX`) and shape.

**Non-Goals:**
- Persisting the streak across process restarts (explicitly declined — see proposal.md; in-memory only).
- Any UI/dashboard for AI health — the INBOX message is the entire interface.
- Retrying or backing off the AI call itself — `AI_MAX_RETRIES` (SDK-level) already covers that; this feature only observes the outcome after those retries are exhausted.

## Decisions

### Reason categorization: fixed taxonomy over `openai` error classes + app error codes
`classifyEmail()` throws in two shapes today:
1. `openai` SDK errors — subclasses of `APIError` (`AuthenticationError`, `RateLimitError`, `APIConnectionTimeoutError`, `APIConnectionError`, `InternalServerError`, `BadRequestError`, etc.), each with a stable `err.constructor.name`.
2. App-level `Error`s thrown by `ai-client.js` (`"Empty response from AI provider"`) and `parseAiClassificationOutput()` in `email-parser.js` (`"AI response is not valid JSON: ..."`, `"AI response missing numeric \"score\" field: ..."`) — both of the latter two interpolate response-dependent text, so raw-message equality would almost never match twice.

New `src/lib/utils/ai-error-reason.js` exports `categorizeAiError(err) -> string`:
- If `err instanceof OpenAI.APIError` (or duck-typed via `err.status`/`err.name` if importing the class is awkward), return `err.constructor.name` (e.g. `'RateLimitError'`) directly — already a small, stable, precise set.
- Else match `err.message` by fixed prefix against the three known app-level messages above, returning a fixed code (`'empty_response'`, `'invalid_json'`, `'missing_score'`) — prefix match, not full-string, so the interpolated suffix is discarded.
- Else `'unknown'`.

Alternative considered: hash/truncate the raw message. Rejected — still fragile (e.g. truncation boundary could split differently between two similar-but-not-identical messages) and less legible in the alert email than a named category.

### Streak state: single active streak, module-scoped, in `ai-failure-tracker.js`
New `src/lib/services/ai-failure-tracker.js` holds one module-level object `{ reason, count, notified, lastError, lastAt }` (no class needed — this is process-global singleton state by design, matching the in-memory, per-process scope decided in the proposal). Exposes:
- `recordFailure(err) -> { shouldAlert: boolean, reason, count, lastError, lastAt }` — categorizes, updates/replaces the streak, and reports whether this call just crossed the threshold and hasn't alerted yet (does *not* itself set `notified` — see below).
- `recordSuccess() -> void` — resets the streak.
- `markNotified() -> void` — called only after the alert email is *successfully* appended; separated from `recordFailure` so a failed IMAP append doesn't permanently suppress the alert (matches the proposal's retry-on-next-failure behavior).

`classifyOne()` calls `recordFailure`/`recordSuccess` right where it already branches on try/catch. `classifyWithAi()` collects at most one `shouldAlert` signal per batch (first one wins — under concurrency several messages could cross the threshold in the same tick, but only one alert should go out) and returns it alongside the existing `{nonSpamMessages, lowSpamMessages}` as a third field, e.g. `aiFailureAlert: {reason, count, lastError, lastAt} | null`.

Alternative considered: pass `imap` into `ai-classification-service.js` and append the alert directly from there. Rejected — no existing service module does IMAP I/O (that's workflow-layer responsibility everywhere else in this codebase: `scan-workflow.js`, `state-manager.js`), and keeping the tracker IMAP-agnostic makes it trivially unit-testable without mocking IMAP.

Concurrency note: `AI_CONCURRENCY` workers can complete out of submission order and interleave `recordFailure`/`recordSuccess` calls. JS's single-threaded event loop makes each individual call atomic (no torn reads/writes), but the *streak* semantics are still only as good as "callers happen to mostly fail for the same reason around the same time" — a batch with truly mixed concurrent failure reasons will thrash the streak and may under-count. Accepted per the proposal's chosen design (single active streak, not a per-reason map); noted in Risks below.

### Alert transport: new generic `appendMessage()` in `imap-client.js`
`state-manager.js` already builds raw RFC822 text and calls `imap.append()` directly, but that helper is state-folder-specific (search-and-replace-by-header semantics) and not reusable. Add `appendMessage(imap, folder, raw, flags = [])` to `imap-client.js` — a thin wrapper around `imap.append()`, consistent with that module already owning all other direct IMAP mailbox operations (`moveMessages`, `updateLabels`, etc.). `scan-workflow.js` builds the alert's raw MIME text (From/To/Subject/Message-ID/Date/Body, no `\Seen` flag so it shows unread) and calls `appendMessage(imap, config.FOLDER_INBOX, raw)` when `aiFailureAlert` is present on the batch result; on success it calls `ai-failure-tracker`'s `markNotified()`.

### Keeping the alert out of rspamd's spam buckets: Message-ID + Bayes training
Manual verification (task 7.3) showed the first alert email landed in `lowSpamMessages`: checked directly against the local rspamd instance, it scored `6.29/15 = 41.9%` (this project's `lowSpam` band is 30-60%). The fired symbols were `HFILTER_HOSTNAME_UNKNOWN` (2.50, an artifact of `checkEmail()` never passing connection/IP metadata to rspamd — applies to every message this app scans this way, not specific to the alert, and out of scope here), `MISSING_MID` (2.50, no `Message-ID` header — the alert is appended directly via IMAP, so unlike normal inbound mail it never passed through an MTA that would add one), and `BAYES_SPAM` (1.29, rspamd's Bayes classifier had never seen this template).

Verified fix, checked against the live instance both ways:
- Adding a `Message-ID: <uuid>@spam-scanner.internal>` header drops the score to `3.79/15 = 25.3%` — under the 30% `nonSpam` threshold. The domain matters: rspamd separately penalizes a Message-ID host that isn't a dotted hostname at all (`MID_RHS_NOT_FQDN`, fires for `@localhost`) and one that matches the From/To domain (`MID_RHS_MATCH_FROM`/`_TO`, fires if the domain is set to `config.IMAP_USER`'s domain) — a fixed, unrelated, dotted domain (`spam-scanner.internal`) avoids both.
- Also calling `learnHam()` (`src/lib/clients/rspamd-client.js`, the same function the ham-training folder already uses — not the whitelist map) on the exact posted content, right after a successful `appendMessage`, flips `BAYES_SPAM` (+1.29) to `BAYES_HAM` (-1.61) on the next occurrence of this template. Score drops to `0.89/15 = 5.9%` — a wide margin instead of a ~1.4-point one. Fire-and-forget: a `learnHam` failure is logged and swallowed, never affects the alert that already posted successfully.

This intentionally does not touch `rspamd/config/multimap.conf`'s whitelist map (per the user's explicit ask) — both fixes are properties of the message itself (a standard header; a factually-true Bayes training signal), not a rule that special-cases the sender address.

## Risks / Trade-offs

- **[Mixed concurrent failure reasons thrash the single streak and never reach threshold]** → Accepted trade-off (explicit proposal decision); in practice a real outage (provider down, bad API key) produces one dominant reason across concurrent requests, so this mainly affects rare mixed-cause windows, not sustained outages.
- **[In-memory streak resets on every process restart, including the default single-run/cron mode]** → Accepted trade-off (explicit proposal decision). Operators running `SCAN_INTERVAL=-1` on a low-volume mailbox may need many cron invocations before an alert fires, since each run's failures may not reach the threshold alone. Documented in `.env.example` next to `AI_FAILURE_ALERT_THRESHOLD`.
- **[The alert email itself flows back through rspamd/AI next cycle]** → Accepted trade-off (explicit proposal decision), now hardened: the Message-ID + `learnHam` combination above was verified end-to-end against a live rspamd instance to keep it in `nonSpamMessages` (5.9% of the reject threshold) rather than relying on an untested assumption.
- **[A batch where several different messages fail with the same reason in the same tick could, in theory, call `markNotified()` more than once if not guarded]** → Mitigate by only checking/consuming `shouldAlert` once per `classifyWithAi()` call (first crossing wins; the tracker's `notified` flag itself prevents a second `shouldAlert: true` until a reset regardless).

## Migration Plan

Purely additive: new config var (defaults to enabled, threshold 3), new files, small additions to three existing files. No data migration, no schema change to the existing scanner-state email format. Rollback is a plain revert; `AI_FAILURE_ALERT_THRESHOLD=-1` also disables it without a code change.
