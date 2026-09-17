## Context

`spam-scanner` classifies inbox mail with rspamd only. `scanBatch()` (`src/lib/workflows/scan-workflow.js`) fetches messages, scores them with rspamd (`processWithRspamd`), and buckets them via `categorizeMessages()` (`src/lib/utils/spam-classifier.js`) into `nonSpamMessages`/`lowSpamMessages`/`highSpamMessages`/`spamMessages`. Only `spamMessages` (rspamd's "reject" action) is auto-moved to the spam folder; the other three buckets are labeled/foldered by a Strategy-pattern processor (`src/lib/processors/*`). rspamd also applies a whitelist multimap (`rspamd/config/multimap.conf`, symbol `WHITELIST_EMAIL`, score `-20`) for senders the mailbox owner has explicitly trusted (e.g. marketing mail they're deliberately subscribed to).

The gap: rspamd's `nonSpam`/`lowSpam` buckets contain false negatives. There is no existing MIME-aware body extraction in the codebase — `parseEmail()` (`src/lib/utils/email-parser.js`) just splits raw content on the first blank line, leaving multipart boundaries, transfer-encoding, and HTML all unprocessed in `body`. A sibling project, `spam-scanner-ai`, was reviewed for inspiration (simple OpenAI-compatible client, JSON-response contract) but its content extraction has the same weakness and is not reused.

## Goals / Non-Goals

**Goals:**
- Catch spam/phishing that rspamd under-scores, using an LLM as a secondary safety net on `nonSpam`/`lowSpam` mail only.
- Never let the AI make mail *less* safe: it can only escalate a message's bucket, never de-escalate, and it can never push a message all the way to `spam` (the only auto-moved, would-be-trained-as-spam bucket) — the worst it can do is `highSpam`, which keeps the message visible for human review.
- Make correct, MIME-aware content extraction (from/to/subject/date, HTML-stripped body text) reusable and correct — this was the primary pain point motivating the change.
- Keep the feature fully opt-in (`AI_ENABLED=false` by default) and a true no-op when disabled.
- Keep AI cost manageable: cache-friendly request shape, bounded concurrency, bounded input/output token budgets, fail-open on error (no retry storms, no batch aborts), and skip AI entirely for mail rspamd's whitelist already vouches for.

**Non-Goals:**
- Replacing rspamd or re-scoring `highSpam`/`spam` mail.
- Native Anthropic (or other non-OpenAI-compatible) provider support.
- Quoted-reply-chain/signature stripping in extracted body text (left for a future iteration).
- Exact tokenizer-based token accounting (a `chars ≈ tokens × 4` heuristic is used instead — see Decisions).
- Caching AI results by content hash across runs (out of scope for v1; scanner state's `last_uid` cursor already means a given message is normally only scanned once).

## Decisions

**1. OpenAI-compatible only, via the official `openai` SDK.**
Rejected: native Anthropic client (extra maintenance surface, not needed — an OpenAI-compatible base URL already covers OpenAI, Ollama, LM Studio, and gateways). Rejected: hand-rolled `fetch` client (what `spam-scanner-ai` does) — the SDK gives typed errors and, critically, built-in `timeout`/`maxRetries` handling for free, removing the need to hand-write and test an `AbortController` + backoff loop.

**2. MIME-aware extraction via `mailparser`, reusing ImapFlow's `envelope` for from/to/subject/date.**
`mailparser`'s `simpleParser(raw).text` already does exactly what's needed: prefers the `text/plain` MIME part, and falls back to converting `text/html` via `html-to-text` when only HTML exists — solving multipart walking, transfer-encoding decoding, and HTML stripping in one call. `envelope.from`/`envelope.to`/`envelope.subject` (from ImapFlow, already fetched) are already MIME-decoded and structured, so they're reused as-is rather than re-parsed. Trade-off: `mailparser` is in upstream maintenance mode (security/bug fixes only); accepted as a stable choice for a long-running Node service — `postal-mime` is a possible future swap if needed.

**3. Escalate-only, capped-below-`spam` re-bucketing.**
Bucket rank `nonSpam=0 < lowSpam=1 < highSpam=2 < spam=3`. `applyAiEscalation()` computes `finalRank = Math.max(originRank, aiTargetRank ?? originRank)`, and `aiTargetRank` is defined so it can never exceed `highSpam`'s rank — there is no threshold that maps to `spam`. This is a double guarantee (algebraic escalate-only via `Math.max`, plus a hard ceiling by construction) rather than a single point of failure. Rationale: `spamMessages` is the only bucket that's auto-moved and the only one that would ever feed spam training, so keeping AI below that rank means a human always reviews AI-flagged mail first.

**4. Fail-open at the service layer, not the client layer.**
`classifyEmail()` (the AI client) throws on failure, exactly like `rspamd-client.js` does — consistent with the existing pattern where clients throw and callers decide. `classifyWithAi()` (the new service) is the single fail-open boundary: it catches per-message errors, logs them, and attaches `aiInfo: {score: null, error}`, which `applyAiEscalation` treats as "no opinion" (stays in the original bucket). This isolates one bad AI response/timeout from aborting an entire scan batch, unlike rspamd's own error handling (which is core to the pipeline and must throw).

**5. Prompt-cache-friendly request shape: static instructions in `system`, variable content in `user`.**
All static text (rubric, safety-net framing, JSON contract, optional `AI_USER_PROFILE`) is built once (`buildSystemPrompt()`, memoized) and sent unchanged as the `system` message on every call; only per-email fields go in the `user` message, with body text last. This is the simplest way to guarantee a byte-identical, cacheable prefix for providers with automatic prompt caching (e.g. OpenAI, which caches identical prefixes ≥1024 tokens automatically, at a steep discount, no special flag needed) — the main cost-control lever for a feature that runs on every non-confident message. No downside if the provider doesn't support caching.

**6. Token budgets via a `chars ≈ tokens × 4` heuristic, not a tokenizer dependency.**
`AI_MAX_INPUT_TOKENS` (default 6000) bounds the body text sent in; `AI_MAX_OUTPUT_TOKENS` (default 2000) is the real `max_completion_tokens` request parameter bounding the reply length - generous because reasoning-family models (o-series, GPT-5) spend part of this budget on hidden reasoning tokens before producing visible output. A precise tokenizer (`js-tiktoken`/`gpt-tokenizer`) was considered but rejected for v1: it adds a dependency and ties truncation to one model family's encoding, when only a rough, configurable ceiling is actually needed.

**7. Only `nonSpamMessages`/`lowSpamMessages` are sent to the AI.**
Keeps AI cost/latency proportional to "uncertain" mail only; `highSpam`/`spam` are already confident rspamd verdicts and are left untouched.

**8. Whitelist exclusion via a dedicated `categorizeMessages` bucket, not a service-layer skip.**
An initial implementation had `classifyWithAi` check `spamInfo.isWhitelisted` per-message and skip the AI call internally. Rejected in favor of a fifth bucket, `whitelistedMessages`, produced by `categorizeMessages()` itself (checked after `isSpam`/reject, so rspamd's own reject verdict always wins even for a whitelisted sender) and excluded from what `scanBatch()` hands to `classifyWithAi` in the first place. Rationale: `classifyWithAi`/`applyAiEscalation` stay pure functions of "the buckets they're given" with zero whitelist-awareness, which is easier to reason about and test than a conditional inside the AI service — the decision of *which mail is even AI-eligible* belongs entirely to categorization, not to the AI layer. `scanBatch()` merges `whitelistedMessages` back into `nonSpamMessages` after the AI/escalation step so labeling/foldering treats it exactly like other clean mail.

## Risks / Trade-offs

- **[Risk]** An AI provider outage or misconfiguration silently disables the safety net (all messages fail open, all stay in their rspamd bucket) → **[Mitigation]** per-message errors are logged at `error` level with the component tag `ai-classification`; a "no-op check" and "fail-open check" are part of the verification/rollout plan so a misconfigured deployment is caught at rollout time, not silently in production.
- **[Risk]** `mailparser`'s maintenance-mode status means slower fixes for any future MIME-parsing edge case or vulnerability → **[Mitigation]** accepted trade-off; `postal-mime` noted as a drop-in-shaped future alternative if needed.
- **[Risk]** The `chars ≈ tokens × 4` heuristic can under- or over-estimate real token counts (English-heavy spam text is close to 4, but URLs/non-Latin scripts skew it) → **[Mitigation]** the budget is a cost ceiling, not a billing-accuracy requirement; a generous default (6000 tokens) absorbs normal variance, and the value is configurable per deployment.
- **[Risk]** Capping AI escalation at `highSpam` means a message the AI is very confident is spam still isn't auto-moved — it requires the mailbox owner to review `highSpam`-labeled/foldered mail → **[Mitigation]** this is intentional (see Decision 3); a future iteration could add an opt-in "AI can reach `spam`" mode once trust in the escalation is established.
- **[Risk]** Uncapped concurrency across a large batch could hit provider rate limits → **[Mitigation]** `AI_CONCURRENCY` (default 5) bounds in-flight requests independently of IMAP fetch batching (`PROCESS_BATCH_SIZE`).
- **[Risk]** A stale or overly broad whitelist entry means a compromised/spoofed sender address is never AI-reviewed, since whitelisted mail bypasses the AI safety net entirely → **[Mitigation]** this mirrors rspamd's own existing trust model (the `-20` score offset already has an outsized effect on categorization today); `isSpam`/reject still overrides the whitelist, so an outright malicious payload from a whitelisted address can still be caught and moved to `spamMessages`. Curating `whitelist.map` correctly remains the mailbox owner's responsibility, unchanged by this feature.

## Migration Plan

- Purely additive: new files, new config (all defaulted so `AI_ENABLED=false` is a byte-for-byte no-op), new dependencies (`mailparser`, `openai`). No schema/state migration needed — scanner state (`last_uid`) is untouched.
- Rollout: deploy with `AI_ENABLED=false` first (no behavior change), verify `npm test` and a no-op manual check, then enable against a disposable/test mailbox before enabling in production.
- Rollback: set `AI_ENABLED=false` (or unset it) — reverts to current behavior immediately, no data cleanup required.

## Open Questions

- Should a future iteration allow AI to escalate all the way to `spam` (auto-move) once the escalation logic has a track record, and if so, under what additional confirmation/threshold?
- Is a content-hash-based cache (to avoid re-classifying/re-billing the same message across restarts) worth adding once real usage volume is known?
