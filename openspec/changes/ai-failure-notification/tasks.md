# Tasks

## 1. Config

- [x] 1.1 Add `AI_FAILURE_ALERT_THRESHOLD` (`parseInt(process.env.AI_FAILURE_ALERT_THRESHOLD || '3', 10)`) to `src/lib/utils/config.js`
- [x] 1.2 Add the matching entry (default `3`, note `-1` disables) to the `# AI Classification Configuration` section of `.env.example`

## 2. Error Reason Categorization

- [x] 2.1 Create `src/lib/utils/ai-error-reason.js` with `categorizeAiError(err) -> string`: `openai` `APIError` subclasses return `err.constructor.name`; the three known app-level messages (`"Empty response from AI provider"`, `"AI response is not valid JSON: ..."`, `"AI response missing numeric \"score\" field: ..."`) return fixed codes (`'empty_response'`, `'invalid_json'`, `'missing_score'`) via prefix match; anything else returns `'unknown'`
- [x] 2.2 Write `test/ai-error-reason.test.js`: each `openai` error subclass, each of the three app-level message prefixes with varying interpolated suffixes (verify they collapse to the same code), a generic `Error` falls back to `'unknown'`

## 3. Failure Tracker

- [x] 3.1 Create `src/lib/services/ai-failure-tracker.js` with module-scoped streak state `{ reason, count, notified, lastError, lastAt }`, `recordFailure(err)`, `recordSuccess()`, `markNotified()`. No separate test-only reset was needed: `recordSuccess()` itself is the reset and is reused as such in `beforeEach`.
- [x] 3.2 Implement `recordFailure`: categorize via `categorizeAiError`; if `reason` matches the active streak, increment `count`, else start a new streak at `count = 1`; always update `lastError`/`lastAt`; return `{ shouldAlert, reason, count, lastError, lastAt }` where `shouldAlert` is `true` only when `count >= AI_FAILURE_ALERT_THRESHOLD` (and threshold `> 0`, i.e. not `-1`/disabled) and `notified` is still `false`
- [x] 3.3 Implement `recordSuccess`: reset the streak to `{ reason: null, count: 0, notified: false, lastError: null, lastAt: null }`
- [x] 3.4 Implement `markNotified`: set `notified = true` on the currently active streak only (no-op if the streak already changed/reset since the alert was decided)
- [x] 3.5 Write `test/ai-failure-tracker.test.js`: threshold crossing fires `shouldAlert`, reason change resets the count to 1, success resets the streak and `notified`, threshold `-1` never sets `shouldAlert`, default threshold `3` behavior, `markNotified` suppresses further alerts for the same streak, and `markNotified` is a no-op once the streak has moved on. Adjusted from the original wording: further same-reason failures *before* `markNotified` is called intentionally keep `shouldAlert: true` (not suppressed) - that's what lets a failed INBOX post (task 6.2) retry on the next failure; de-duplication within one batch is handled by `classifyWithAi` only acting on the first `shouldAlert: true` it sees (task 4.2), not by the tracker itself. Tested accordingly.

## 4. Wire Into Classification Service

- [x] 4.1 Call `ai-failure-tracker`'s `recordFailure`/`recordSuccess` from `classifyOne()` in `src/lib/services/ai-classification-service.js` at the existing try/catch branch points
- [x] 4.2 Have `classifyWithAi()` collect at most one `aiFailureAlert` (`{ reason, count, lastError, lastAt } | null`) per call — the first `shouldAlert: true` result encountered among the batch's outcomes — and return it as a third field alongside `nonSpamMessages`/`lowSpamMessages`
- [x] 4.3 Extend `test/ai-classification-service.test.js`: a batch whose failures cross the threshold surfaces `aiFailureAlert`; a batch below threshold returns `aiFailureAlert: null`; a batch with no failures returns `aiFailureAlert: null`

## 5. IMAP Append Helper

- [x] 5.1 Add `appendMessage(imap, folder, raw, flags = [])` to `src/lib/clients/imap-client.js` (thin wrapper around `imap.append()`)
- [x] 5.2 Adjusted: `imap-client.js` has no dedicated unit test file for any of its functions (it's a thin ImapFlow wrapper; `moveMessages`/`updateLabels`/etc. are likewise only exercised indirectly) - `appendMessage` is covered the same way, through the `scan-workflow.test.js` mock assertions in task 6.3, consistent with the module's existing test convention.

## 6. Wire Into Scan Workflow

- [x] 6.1 In `scanBatch()` (`src/lib/workflows/scan-workflow.js`), after the `classifyWithAi` call, when `aiResults.aiFailureAlert` is present: build a plain-text RFC822 message (From/To/Subject naming the reason, Date, body with reason/count/last error/timestamp), call `appendMessage(imap, config.FOLDER_INBOX, raw)` (no `\Seen` flag), and on success call `ai-failure-tracker`'s `markNotified()`
- [x] 6.2 On `appendMessage` failure, log the error and leave the tracker un-notified (no `markNotified()` call) so the next failure retries the post
- [x] 6.3 Extend `test/scan-workflow.test.js`: `aiFailureAlert` present triggers `appendMessage` to `config.FOLDER_INBOX` with expected content and then `markNotified`; `aiFailureAlert: null` triggers no append; `appendMessage` throwing does not abort the batch and does not call `markNotified`
- [x] 6.4 (Found during manual verification 7.3) Add a `Message-ID` header to the alert email and call `learnHam()` (`src/lib/clients/rspamd-client.js`) on it after a successful `appendMessage`, fire-and-forget. Verified against a live rspamd instance: without this, the alert scored 41.9% of the reject threshold (`lowSpam` bucket); with it, 5.9% (`nonSpam`). See `design.md`'s "Keeping the alert out of rspamd's spam buckets" decision for the exact symbols/scores. Extended `test/scan-workflow.test.js` (Message-ID present, `learnHam` called with the posted content, a `learnHam` failure doesn't affect the already-posted alert or the tracker) and `.env.example`'s comment is unaffected (no new config).

## 7. Documentation & Verification

- [x] 7.1 Checked `docs/features/` for the design/plan template this project used to follow: that convention was discontinued after 2026-02-19 (confirmed via `git log -- docs/features/`) once the project moved to the openspec workflow used here, and no later feature (including `ai-spam-escalation`) added new files there. No `docs/features/` files added for this change; `proposal.md`/`design.md` in this change directory serve that role. Also updated `.env.example` per 1.2.
- [x] 7.2 Ran `npm test`: 210 passed, 3 failed - the same 3 failures (`email-parser.test.js` rspamd-action parsing, two `rspamd-maps.test.js` ordering assertions) reproduce identically on `master` via `git stash`, confirming they're pre-existing and unrelated to this change.
- [ ] 7.3 Manual verification against a disposable/test IMAP mailbox: force `AI_FAILURE_ALERT_THRESHOLD` consecutive same-reason failures (e.g. point `AI_BASE_URL` at an unreachable host), confirm exactly one alert message appears unread in `INBOX` — **user-performed**
- [ ] 7.4 Manual recovery check: after an alert has fired, restore AI connectivity, confirm the next successful classification resets tracking, then force the threshold again and confirm a second alert is posted — **user-performed**
- [ ] 7.5 Manual disabled check: `AI_FAILURE_ALERT_THRESHOLD=-1`, force sustained AI failures, confirm no alert is ever posted to `INBOX` — **user-performed**
