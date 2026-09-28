# prompt-engineer

Analyze `eval-prompt`'s reports and tune the AI spam classifier's system prompt to fix
observed per-bucket miscalibration (e.g. legitimate mail scoring too high).

## What this does

The repo-root `bin/eval-prompt.ts` scores a labeled `.eml` dataset (`--ham`/`--marketing`/
`--spam` folder arguments, plus a mandatory `--reports` folder) against a system prompt
supplied as a plain text file (`--prompt <file>`), and writes a timestamped report under
`--reports`. Run it from the repo root via:

```
npm run eval-prompt -- --prompt <prompt-file> --reports <folder> \
  --ham <folder> --marketing <folder> --spam <folder>
```

(This imports the same `extractAiContent`/`buildUserContent` functions `AiGateway` uses in
production, from the `shared` package's pre-built output, so the request shape sent to the
model matches production exactly - no server build needed, only `shared` having been built
at least once. AI request settings - model, base URL, tokens, concurrency - come from the
same `AI_*` env vars production reads, loaded from the repo-root `.env` by default, or
`--env <path>`.)

Because the prompt under test lives in its own text file, not in application code,
iterating on it never touches `server/src/` - only the production prompt in
`AiGateway.buildSystemPrompt()` (`server/src/infrastructure/ai/ai.gateway.ts`) is real
application code, and this skill only edits that file once a tested change is ready to
ship (see step 4 below).

This skill reads a report, judges whether each bucket's scores are calibrated, and - only
if a prompt wording change would fix it - edits the prompt file under test.

Calibration to look for, per bucket:

- `ham` (legitimate mail): scores should sit low, comfortably under the report header's
  `escalateToLowThreshold`. A ham message scoring near or above that is a false positive -
  the exact problem this tool exists to catch.
- `marketing` (mail the user is legitimately subscribed to): scores should also stay under
  `escalateToLowThreshold` - it should not get flagged for review - but the reasoning text
  may legitimately mention marketing/promotional framing.
- `spam` (phishing/scam/unwanted mail): scores should sit high, at or above the header's
  `escalateToHighThreshold`.

## Procedure

1. **Find the report(s).** List the reports folder the user names (or ask which one, if
   unclear) and read the most recent report. If there are no report files, do not guess or
   fabricate findings - tell the user to run `npm run eval-prompt -- --prompt <file>
   --reports <folder> --ham <folder> --marketing <folder> --spam <folder>` first (from
   the repo root) and stop.

2. **Analyze per bucket.** For each bucket section in the report, compare its scores
   against the calibration expectations above. Read the `reasoning` text for outliers (a
   ham message scoring high, a spam message scoring low, a marketing message scoring like
   spam) - the reasoning usually reveals which signal the prompt is under- or over-weighing
   (e.g. ignoring a trusted from-address, treating routine transactional language as
   suspicious, not distinguishing "subscribed marketing" from "unsolicited marketing").

3. **Read the prompt file under test** (the path in the report's `prompt:` header line) in
   full before proposing any change.

4. **Decide the fix.**
   - If the miscalibration traces to prompt _wording_ (a signal underused, an ambiguous
     instruction, a missing distinction the reasoning text shows the model needs), edit
     that prompt file directly - keep edits minimal and targeted at the specific evidence
     found; do not rewrite the whole prompt from scratch. This is a plain text file, not
     application code, so edit it freely while iterating.
   - Only once the user confirms a tested prompt file is ready to ship, apply the same
     wording to `buildSystemPrompt()` in `server/src/infrastructure/ai/ai.gateway.ts` -
     and _only_ that method in that file. Never make this promotion silently; say
     explicitly that you're copying the tested prompt into production code.
   - If the real fix is not a prompt-wording problem (e.g. the mailbox's own
     `aiEscalation` thresholds are simply set too aggressively - see
     `mailbox-settings.defaults.ts` - or a dataset example is mislabeled, or the model
     itself is a poor fit), do **not** edit any config or settings file yourself. State the
     recommendation to the user instead and explain why it's outside this skill's edit
     scope.

5. **Explain the change.** In your response, name the specific bucket/file/score evidence
   that motivated the edit (e.g. "`Your Subscription Renewal - Apple....eml` scored 22, the
   reasoning cited an empty body with no billing details as suspicious even though the
   sender is a known transactional domain - strengthened the from-address trust signal").
   The edit itself must be visible as a normal `git diff` (on the prompt file while
   iterating, or on `ai.gateway.ts` when promoting) - never applied silently or described
   only in prose.

6. **Suggest the next step.** While iterating, tell the user to re-run `eval-prompt`
   against the same dataset folders with the edited prompt file to get a new timestamped
   report, and to compare it against the one just analyzed to confirm the targeted bucket
   improved without regressing the others.

## Boundaries

- Never invent report data. Every claim about a score or reasoning string must be traceable
  to an actual line in a report file you read this session.
- While iterating, edit only the prompt text file under test - never
  `server/src/infrastructure/ai/ai.gateway.ts` or any other application file. Only
  touch `buildSystemPrompt()` in `ai.gateway.ts` once the user confirms the tested prompt
  is ready to promote to production, and never touch any other method or file for that
  promotion. If fixing the problem seems to require changing `buildUserContent()`,
  `classifyEmail()`, or anything else, stop and ask the user first.
- Never edit `.env`, `.env.example`, `mailbox-settings.defaults.ts`, or any config/settings
  file to "fix" calibration - those changes are the user's call, not this skill's.
- Don't run `eval-prompt` yourself unless the user asks you to - it costs real API calls
  against their `.env` credentials. Analyze existing reports; let the user decide when to
  spend another run.
