# prompt-engineer

Analyze ai-prompt-eval reports and edit the AI spam classifier's system prompt to fix
observed per-bucket miscalibration (e.g. legitimate mail scoring too high). Requires a
report from `src/cli/eval-prompt.ts` to already exist in `.temp/reports/`.

You are tuning the spam-scanner project's AI safety-net prompt. This skill implements the
`ai-prompt-engineer` capability (see `openspec/specs/ai-prompt-engineer/spec.md` once
archived, or `openspec/changes/ai-prompt-tuning/specs/ai-prompt-engineer/spec.md` before
archive). Read that spec if present - it is the authoritative behavior contract; this file
is operational guidance for following it.

## What this skill is for

`src/cli/eval-prompt.ts` scores a labeled `.eml` dataset (`--ham`/`--marketing`/`--spam`
folder arguments, plus a mandatory `--reports` folder) with the _current_ production prompt
and writes a timestamped report under `--reports`. This skill reads that report, judges
whether each bucket's scores are calibrated, and - only if a prompt wording change would
fix it - edits the prompt.

Calibration to look for, per bucket:

- `ham` (legitimate mail): scores should sit low, comfortably under
  `AI_ESCALATE_TO_LOW_THRESHOLD` (see the report header). A ham message scoring near or
  above that threshold is a false positive - the exact problem this tool exists to catch.
- `marketing` (mail the user is legitimately subscribed to): scores should also stay under
  `AI_ESCALATE_TO_LOW_THRESHOLD` - it should not get flagged for review - but the reasoning
  text may legitimately mention marketing/promotional framing.
- `spam` (phishing/scam/unwanted mail): scores should sit high, at or above
  `AI_ESCALATE_TO_HIGH_THRESHOLD`.

## Procedure

1. **Find the report(s).** List the reports folder (by convention `.temp/reports/`) and
   read the most recent report (or whichever the user names). If there are no report files,
   do not guess or fabricate findings - tell the user to run `node src/cli/eval-prompt.ts
--reports <folder> --ham <folder> --marketing <folder> --spam <folder>` first (see the
   README's "Tuning the AI prompt offline" section) and stop.

2. **Analyze per bucket.** For each bucket section in the report, compare its scores
   against the calibration expectations above. Read the `reasoning` text for outliers (a
   ham message scoring high, a spam message scoring low, a marketing message scoring like
   spam) - the reasoning usually reveals which signal the prompt is under- or over-weighing
   (e.g. ignoring a trusted from-address, treating routine transactional language as
   suspicious, not distinguishing "subscribed marketing" from "unsolicited marketing").

3. **Read the current prompt.** Open `src/lib/clients/ai.client.ts` and read
   `buildSystemPrompt()` in full before proposing any change.

4. **Decide the fix.**
   - If the miscalibration traces to prompt _wording_ (a signal underused, an ambiguous
     instruction, a missing distinction the reasoning text shows the model needs), edit
     `buildSystemPrompt()` in `src/lib/clients/ai.client.ts` - and _only_ that function in
     that file. Keep edits minimal and targeted at the specific evidence found; do not
     rewrite the whole prompt from scratch.
   - If the real fix is not a prompt-wording problem (e.g. `AI_ESCALATE_TO_LOW_THRESHOLD`
     is simply set too aggressively, or a dataset example is mislabeled, or the model itself
     is a poor fit), do **not** edit `.env`, `config.ts`, or any other file yourself. State
     the recommendation to the user instead and explain why it's outside this skill's edit
     scope.

5. **Explain the change.** In your response, name the specific bucket/file/score evidence
   that motivated the edit (e.g. "`Your Subscription Renewal - Apple....eml` scored 22,
   the reasoning cited an empty body with no billing details as suspicious even though the
   sender is a known transactional domain - strengthened the from-address trust signal").
   The edit itself must be visible as a normal `git diff` on `ai.client.ts` - never applied
   silently or described only in prose.

6. **Suggest the next step.** Tell the user to re-run `src/cli/eval-prompt.ts` against the
   same dataset folder to get a new timestamped report, and to compare it against the one
   just analyzed to confirm the targeted bucket improved without regressing the others.

## Boundaries

- Never invent report data. Every claim about a score or reasoning string must be traceable
  to an actual line in a report file you read this session.
- Never edit more than `buildSystemPrompt()` in `src/lib/clients/ai.client.ts`. If fixing
  the problem seems to require touching `buildUserContent()`, `classifyEmail()`, or any
  other file, stop and ask the user first - that's outside this skill's scope per the
  `ai-prompt-engineer` spec.
- Never edit `.env`, `.env.example`, or `config.ts` to "fix" calibration - config changes
  are the user's call, not this skill's.
- Don't run `src/cli/eval-prompt.ts` yourself unless the user asks you to - it costs real
  API calls against their `.env` credentials. Analyze existing reports; let the user decide
  when to spend another run.
