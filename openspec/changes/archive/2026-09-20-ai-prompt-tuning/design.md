# Design

## Context

See `proposal.md` - Why. Relevant existing code this builds on:

- `src/lib/clients/ai.client.js` exports `buildSystemPrompt()`, `buildUserContent()`, and
  `classifyEmail()` - the exact functions production scanning uses. This change must call
  these unmodified, never fork/duplicate them, so an eval run and a production run always
  agree given the same input.
- `src/lib/services/ai-content.service.js`'s `extractAiContent(message, { maxInputTokens })`
  is what turns a raw message into the `{from, to, subject, date, text}` classifier input.
  It expects `message = {uid, envelope, raw}` where `envelope` is ImapFlow's parsed
  envelope shape (`from`/`to` as `[{name, address}]`, `subject` string, `date` Date). A
  local `.eml` file has no ImapFlow envelope - one has to be synthesized from the file
  itself.
- `src/lib/controllers/steps/ai-classification.step.js`'s `classifyOne`/`classifyWithAi`
  already show the established pattern for per-message try/catch (fail open, never abort
  the batch) and bounded concurrency via `mapWithConcurrency` + `ctx.config.AI_CONCURRENCY`.
  This change reuses that pattern rather than inventing a new one.
- `src/lib/core/config.js` is the only place reading `process.env`; the eval CLI reads AI
  settings through it like everything else, never `process.env` directly.

## Goals / Non-Goals

**Goals:**
- Reuse `extractAiContent` and `classifyEmail` unmodified so eval results are trustworthy
  as a stand-in for production behavior.
- Keep the eval CLI and skill fully decoupled from IMAP - no IMAP connection is opened.
- Follow the project's existing layering (`clients` -> `services`/`utils` -> `controllers`)
  so the new code is testable the same way the rest of the codebase is.

**Non-Goals:**
- Not building an automated scoring/threshold/target formula (e.g. "deviation from target
  score") - the report presents raw per-bucket scores and reasoning; a human or the skill
  judges calibration, informed by the existing `AI_ESCALATE_TO_LOW/HIGH_THRESHOLD` values.
- Not changing any production runtime behavior (`ai-spam-escalation` is unmodified) - this
  is an offline tool that happens to read the same prompt/config production uses.
- Not automating iteration end-to-end (no code-driven loop that reruns the CLI and invokes
  the skill on its own); the human drives each iteration - run eval, invoke skill, review
  diff, rerun eval.

## Decisions

### Synthesize an envelope once per file, reuse `extractAiContent` unchanged
A new `src/lib/clients/eml-dataset.client.js` reads `.eml` files off disk. For each file it
runs `mailparser`'s `simpleParser` once to obtain `from`/`to`/`subject`/`date` in the same
shape ImapFlow's envelope already has (`parsed.from.value` is `[{name, address}]`, etc.),
builds a `{uid: <bucket>/<filename>, envelope, raw}` object, and hands it to the *unmodified*
`extractAiContent`. `extractAiContent` internally runs its own `simpleParser` pass for the
`text` field.

Alternative considered: extend `extractAiContent` to derive `from`/`to`/`subject`/`date`
itself when `message.envelope` is absent, avoiding the double parse. Rejected: it would add
an eval-only code path into a production service, and the requirement is production-
equivalent *behavior*, not maximal parsing efficiency - datasets here are small (tens to
low hundreds of files), so a second `simpleParser` pass per file is immaterial.

### Report formatting is a pure service; file I/O is a thin client
`src/lib/services/prompt-eval-report.service.js` takes the already-classified results plus
a config snapshot and returns report text (header, per-bucket sections, per-bucket
summary). It is pure and 100% unit tested like every other service. Writing that text to
`.temp/reports/<timestamp>.txt` is a one-line client concern
(`src/lib/clients/report-file.client.js`), kept separate so the formatting logic needs no
filesystem mocking to test.

### CLI does not follow the IMAP `newClient()`/`connect()`/`safeLogout()` pattern
`src/cli/eval-prompt.js` never touches IMAP, so that convention doesn't apply. It parses
the dataset folder path from `process.argv`, calls a new
`src/lib/controllers/workflows/prompt-eval.controller.js` (`ctx` trailing parameter,
defaulted to `createDefaultContext()`, per the standard controller pattern), and prints the
written report's path. This is a deliberate, documented deviation from the IMAP-script
convention, not an oversight.

### Concurrency reuses `AI_CONCURRENCY`, no new config
The classification step reuses `mapWithConcurrency` bounded by `ctx.config.AI_CONCURRENCY`
- the same knob and mechanism production classification already uses. No new tuning-
specific rate-limit config is introduced; if the existing default proves too aggressive for
batch runs, it's a config value the user already controls.

### Skill is scoped to editing one function, not general refactor authority
The `ai-prompt-engineer` skill (`.claude/skills/prompt-engineer/`) is instructed to read
report files from `.temp/reports/` and edit only `buildSystemPrompt()` in
`src/lib/clients/ai.client.js`, per the `ai-prompt-engineer` spec. It surfaces (but does
not apply) any suggestion that would require a non-prompt change (config value, other
file). This keeps every change it makes a small, single-purpose, reviewable diff.

## Risks / Trade-offs

- [Report reading is manual, iteration is human-paced] -> acceptable per Non-Goals; the
  point is transparency (git-diffable prompt edits) over speed.
- [Double-parsing each `.eml` (once for envelope, once inside `extractAiContent`)] ->
  negligible at the dataset sizes this tool targets; revisit only if datasets grow into the
  thousands.
- [Eval run cost/rate limits against the real AI provider] -> bounded by the existing
  `AI_CONCURRENCY`/`AI_MAX_RETRIES` config already tuned for production; no new mechanism
  needed.
- [Empty `marketing/` bucket until the user populates it] -> the CLI and report format
  handle a zero-file bucket the same as any other (empty section, no summary stats), so
  this is a data-population step for the user, not a code gap.

## Migration Plan

Purely additive - new files, new `.temp/messages/marketing/` and `.temp/reports/`
directories, no changes to existing exports' signatures or to `ai-spam-escalation`
behavior. Nothing to migrate or roll back beyond removing the new files.
