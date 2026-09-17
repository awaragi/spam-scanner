## Why

rspamd's `nonSpam` and `lowSpam` buckets contain false negatives — mail that is actually spam or phishing but scored too low to be flagged. Getting a second, LLM-based opinion specifically on those two buckets can catch what rspamd's rule/Bayes-based scoring misses, without touching the buckets rspamd is already confident about (`highSpam`/`spam`).

## What Changes

- Add an optional AI classification pass (`AI_ENABLED`, default `false` — a true no-op when disabled) that re-checks only rspamd's `nonSpamMessages` and `lowSpamMessages` after `categorizeMessages()`, using an OpenAI-compatible chat-completions API (real OpenAI, Ollama, LM Studio, or any compatible gateway) via the official `openai` SDK.
- Add MIME-aware content extraction (`extractAiContent`, using `mailparser`) that produces a clean `{from, to, subject, date, text}` payload for the AI — `text` is the plain-text body, or an HTML→text conversion when only an HTML part exists, correctly handling MIME multipart/transfer-encoding that the existing `parseEmail()` does not.
- Add an escalate-only re-bucketing rule (`applyAiEscalation`): a message can move to a *more* severe bucket than rspamd assigned it, capped at `highSpam` — `nonSpam → lowSpam/highSpam`, `lowSpam → highSpam` — and can never be de-escalated and never escalated all the way to `spam`. Only rspamd's own "reject" verdict can put a message in `spamMessages`, which is the only bucket that is auto-moved to the spam folder. This guarantees a human always reviews AI-flagged mail (via its `highSpam` label/folder) before anything is physically moved to spam or would ever be used to train the spam filter.
- Add fail-open error handling: any per-message AI failure (timeout, network error, malformed response) is logged and leaves that message in its original rspamd bucket — it never aborts the batch.
- Add a prompt-cache-friendly request shape: all static instructions (rubric, safety-net framing, optional user profile) go in the `system` message, computed once and reused byte-for-byte; only the per-email content goes in the `user` message. This is structured to benefit from providers' automatic prompt-prefix caching (e.g. OpenAI's), which is the main cost-control lever for a feature that can run on every non-confident message.
- Add configurable token budgets: `AI_MAX_INPUT_TOKENS` (email body sent to the AI) and `AI_MAX_OUTPUT_TOKENS` (the model's `{score, reasoning}` reply).
- Add a fifth `categorizeMessages()` bucket, `whitelistedMessages`, for mail whose sender matched rspamd's whitelist (the `WHITELIST_EMAIL` symbol, see `rspamd/config/multimap.conf`) — surfaced as `spamInfo.isWhitelisted`. `scanBatch()` never sends this bucket to `classifyWithAi`, since a human-curated whitelist entry is a stronger trust signal than an AI re-check; this avoids spending AI budget on marketing mail the mailbox owner is deliberately subscribed to. Whitelisted messages are merged back into `nonSpamMessages` after the (optional) AI/escalation step so they're labeled/foldered exactly like other clean mail. `classifyWithAi`/`applyAiEscalation` themselves have no whitelist-awareness — the split happens entirely at categorization and workflow-wiring level, keeping the AI layer a pure function of "the buckets it's handed."

## Capabilities

### New Capabilities
- `ai-spam-escalation`: AI-based re-classification of rspamd's non-confident (`nonSpam`/`lowSpam`) buckets, with an escalate-only, capped-below-spam re-bucketing rule and fail-open error handling.

### Modified Capabilities
_None._ `scan-inbox`'s existing requirements (UID filtering, `run()` return value) are unaffected — this change adds a new step inside `scanBatch()` between existing steps, without changing scan-inbox's own contract.

## Impact

- New files: `src/lib/utils/ai-content.js`, `src/lib/clients/ai-client.js`, `src/lib/services/ai-classification-service.js`.
- Modified files: `src/lib/workflows/scan-workflow.js` (wiring + whitelist exclusion/merge), `src/lib/utils/spam-classifier.js` (`applyAiEscalation`, `categorizeMessages` gains the `whitelistedMessages` bucket), `src/lib/utils/email-parser.js` (`parseAiClassificationOutput`, `parseRspamdOutput` now returns `isWhitelisted`), `src/lib/services/message-service.js` (`spamInfo.isWhitelisted` passthrough), `src/lib/utils/config.js`, `.env.example`, `package.json`.
- New dependencies: `mailparser` (MIME parsing/HTML-to-text), `openai` (official SDK, OpenAI-compatible chat completions).
- No changes to `folder-processor.js`/`label-processor.js`/`color-processor.js`, rspamd client/training, or any existing test's behavior when `AI_ENABLED=false` (the default).
