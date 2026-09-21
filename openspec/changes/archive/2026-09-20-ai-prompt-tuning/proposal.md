# Proposal

## Why

The AI safety-net classifier (`ai.client.js`) is currently escalating legitimate mail to
the "low spam" bucket often enough that senders have to be added to the whitelist just to
skip AI scoring entirely - defeating the point of having a safety net. There is no way to
measure classifier quality against real labeled examples before or after changing the
system prompt (or other `AI_*` config such as model or token limits), so every change is
shipped blind and regressions are only discovered in production.

## What Changes

- New CLI script (`src/cli/`) that takes a folder path as an argument, loops over labeled
  `.eml` messages grouped into subfolders by bucket (`ham/`, `marketing/`, `spam/`), parses
  each message the same way the production scan path does (reusing the existing
  `extractAiContent`/`mailparser`-based extraction), classifies each with the current
  `buildSystemPrompt()`/`classifyEmail()` using the same `.env` AI credentials and config as
  production, and writes a timestamped plain-text report.
- Batch processing is concurrency-bounded using the existing `AI_CONCURRENCY` config and
  `mapWithConcurrency` util (same mechanism `ai-classification.step.js` already uses), so
  runs are fast without tripping provider rate limits.
- The report groups results by bucket (per-email filename/score/reasoning plus a per-bucket
  summary), and its header records the AI config actually used for that run (model, max
  input/output tokens, escalation thresholds, etc.) so two reports stay comparable even
  when something other than the prompt text changes between runs.
- Reports are written to a new `.temp/reports/` folder, one timestamped file per run, so a
  "before" and "after" report both exist for comparison after a prompt edit.
- New `.temp/messages/marketing/` folder (alongside the existing `ham/` and `spam/`) for
  labeled examples of subscribed-to marketing mail that should score low but not as low as
  clearly legitimate transactional mail.
- New "prompt-engineer" Claude Code skill (`.claude/skills/`) that reads one or more eval
  reports, reasons about per-bucket miscalibration (e.g. legitimate mail scoring too high,
  the from-address signal being underused), and edits `buildSystemPrompt()` in
  `src/lib/clients/ai.client.js` directly, leaving the change as a normal reviewable git
  diff rather than an opaque automated rewrite.

## Capabilities

### New Capabilities

- `ai-prompt-eval`: offline batch classification of a labeled `.eml` dataset against the
  current AI classifier configuration, producing a timestamped, comparable text report.
- `ai-prompt-engineer`: a Claude Code skill that analyzes eval reports and edits the
  production system prompt based on observed per-bucket miscalibration.

### Modified Capabilities

_(none - production scan/escalation behavior in `ai-spam-escalation` is unchanged; this
change only adds an offline tool that reads the same prompt/config the production path
already uses)_

## Impact

- New files: a CLI entry script under `src/cli/`, its supporting service/step/util code
  under `src/lib/` following the existing layering, and `.claude/skills/prompt-engineer/`.
- New directories: `.temp/messages/marketing/` (empty, user-populated) and `.temp/reports/`
  (gitignored, timestamped report output).
- Reuses existing `.env`/`config.js` values (`AI_API_KEY`, `AI_MODEL`, `AI_CONCURRENCY`,
  `AI_MAX_INPUT_TOKENS`, `AI_ESCALATE_TO_LOW_THRESHOLD`/`AI_ESCALATE_TO_HIGH_THRESHOLD`,
  etc.) - no new environment variables are required.
- No changes to `ai-spam-escalation` runtime behavior or its public exports'
  signatures (`buildSystemPrompt()`, `buildUserContent()`, `classifyEmail()`); the eval CLI
  only reads from `ai.client.js`, it does not fork or duplicate the classification logic.
