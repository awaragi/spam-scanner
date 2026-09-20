## 1. Dependencies & Config

- [x] 1.1 Add `mailparser` and `openai` to `package.json` dependencies; run `npm install`
- [x] 1.2 Add `AI_*` config entries to `src/lib/utils/config.js` (`AI_ENABLED`, `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `AI_TIMEOUT_MS`, `AI_MAX_RETRIES`, `AI_CONCURRENCY`, `AI_MAX_INPUT_TOKENS`, `AI_MAX_OUTPUT_TOKENS`, `AI_ESCALATE_TO_LOW_THRESHOLD`, `AI_ESCALATE_TO_HIGH_THRESHOLD`, `AI_USER_PROFILE`)
- [x] 1.3 Add the matching `# AI Classification Configuration` section to `.env.example`

## 2. Content Extraction

- [x] 2.1 Create `src/lib/utils/ai-content.js` with `extractAiContent(message, opts)` — from/to/subject/date sourced from `message.envelope`, `text` via `mailparser`'s `simpleParser(message.raw)`
- [x] 2.2 Implement token-budgeted truncation of `text` using the `chars = tokens * 4` heuristic against `config.AI_MAX_INPUT_TOKENS`
- [x] 2.3 Write `test/ai-content.test.js`: plain-text-only, HTML-only, multipart/alternative (prefers plain part), quoted-printable, base64, truncation boundary, malformed-MIME rejection

## 3. AI Client

- [x] 3.1 Create `src/lib/clients/ai-client.js`; construct the `openai` SDK client once from `{apiKey, baseURL, timeout, maxRetries}` config
- [x] 3.2 Implement `buildSystemPrompt()` (memoized, static instructions + rubric + optional `AI_USER_PROFILE`) and `buildUserContent(content)` (per-email fields only, body last)
- [x] 3.3 Implement `classifyEmail(content)` calling `chat.completions.create` with `model`, the two messages, `max_completion_tokens: config.AI_MAX_OUTPUT_TOKENS`
- [x] 3.4 Add `parseAiClassificationOutput(content)` to `src/lib/utils/email-parser.js` (alongside `parseRspamdOutput`): strip markdown fences, validate/clamp `score`, default `reasoning`
- [x] 3.5 Write `test/ai-client.test.js`: request shape, `buildUserContent` isolated to the user message, response parsing wired in, empty/missing content throws, SDK error propagates unchanged, system message identical across two different calls (cache-shape regression), system message never contains per-email field values
- [x] 3.6 Extend `test/email-parser.test.js` for `parseAiClassificationOutput`: valid JSON, fenced JSON (with/without `json` tag), score clamping, missing/non-numeric score throws, missing reasoning defaults, garbage input throws

## 4. Classification Service (fail-open boundary)

- [x] 4.1 Create `src/lib/services/ai-classification-service.js` with `classifyWithAi({nonSpamMessages, lowSpamMessages})`
- [x] 4.2 Implement bounded concurrency via `config.AI_CONCURRENCY`
- [x] 4.3 Implement per-message try/catch: attach `aiInfo: {score, reasoning, error: null}` on success, `aiInfo: {score: null, reasoning: null, error: message}` on failure — never rethrow
- [x] 4.4 Short-circuit to `{nonSpamMessages: [], lowSpamMessages: []}` when both inputs are empty
- [x] 4.5 Write `test/ai-classification-service.test.js`: success path, per-message fail-open (siblings unaffected, no rethrow), concurrency cap respected, empty-input short circuit, output array shape/order preserved

## 5. Escalation Logic

- [x] 5.1 Add `applyAiEscalation(categorized, aiResults, thresholds)` to `src/lib/utils/spam-classifier.js` using bucket ranks `nonSpam=0 < lowSpam=1 < highSpam=2 < spam=3`
- [x] 5.2 Ensure `aiTargetRank` can never map to `spam`'s rank (construction-level cap, not just the `Math.max` escalate-only guard)
- [x] 5.3 Write/extend `test/spam-classifier.test.js` for `applyAiEscalation`: all origin×outcome combinations, boundary threshold values, fail-open case, regression test that no AI score ever produces `nonSpamMessages` de-escalation, regression test that no AI score ever produces a `spamMessages` result

## 6. Wire Into Scan Workflow

- [x] 6.1 Modify `scanBatch()` in `src/lib/workflows/scan-workflow.js`: call `classifyWithAi` + `applyAiEscalation` between `categorizeMessages()` and `processor.process()`, gated on `config.AI_ENABLED`
- [x] 6.2 Extend `test/scan-workflow.test.js`: `AI_ENABLED=false` no-op check (raw `categorizeMessages` output reaches processor/moveMessages), `AI_ENABLED=true` wiring check (both new functions called with expected args)

## 7. Documentation & Verification

- [x] 7.1 Add `docs/features/20260917-ai-spam-escalation-design.md` and `-plan.md` using the existing templates
- [x] 7.2 Run `npm test` — full suite green (3 pre-existing failures on `master`, unrelated to this change, confirmed via `git stash` comparison)
- [x] 7.3 Manual verification against a disposable/test IMAP mailbox: `AI_ENABLED=true` end-to-end run, confirm escalated messages land in expected label/folder and are never auto-moved to the spam folder — **user-performed**; `.env` credentials were intentionally not read by the implementing agent
- [x] 7.4 Manual fail-open check: point `AI_BASE_URL` at an unreachable host, confirm the scan completes and all candidates stay in their original buckets — **user-performed**
- [x] 7.5 Manual no-op check: `AI_ENABLED=false`, confirm no `ai-*` log lines and identical bucket outcomes to pre-change behavior — **user-performed**

## 8. Whitelist Bucket (cost optimization)

- [x] 8.1 Add `isWhitelisted` to `parseRspamdOutput` (`src/lib/utils/email-parser.js`), derived from rspamd's `WHITELIST_EMAIL` symbol
- [x] 8.2 Thread `isWhitelisted` through `spamInfo` in `src/lib/services/message-service.js`
- [x] 8.3 Add a `whitelistedMessages` bucket to `categorizeMessages()` (`src/lib/utils/spam-classifier.js`): checked after `isSpam`/reject (which still wins), before score-percentage bucketing
- [x] 8.4 Wire `scanBatch()` (`src/lib/workflows/scan-workflow.js`) to exclude `whitelistedMessages` from the `classifyWithAi` call and merge it back into `nonSpamMessages` before `processor.process`/`moveMessages`, unconditionally (not gated on `AI_ENABLED`)
- [x] 8.5 Add `whitelistedCount`/`whitelistedTotal` to `scanBatch`/`runScan` logging for cost-savings visibility
- [x] 8.6 Extend `test/email-parser.test.js`, `test/spam-classifier.test.js` (new `whitelistedMessages` bucket coverage, including reject-overrides-whitelist), and `test/scan-workflow.test.js` (whitelisted messages excluded from `classifyWithAi`, merged into the final `nonSpamMessages`)
- [x] 8.7 Confirm `classifyWithAi`/`applyAiEscalation` required zero code changes (whitelist-awareness lives entirely in categorization/workflow wiring, not the AI layer)
