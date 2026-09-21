# Tasks

## 1. Dataset scaffolding

- [x] 1.1 Add `.temp/messages/marketing/` (empty, with a `.gitkeep` or similar so the folder
      exists) alongside the existing `ham/` and `spam/` folders, and verify `.temp/` and its
      contents remain excluded via `git status` showing nothing new tracked
- [x] 1.2 Add `.temp/reports/` output location and verify a file written there does not show
      up in `git status` (already covered by the existing `.temp` gitignore entry - confirm
      with `git check-ignore -v .temp/reports/anything.txt`)

## 2. Dataset loading client

- [x] 2.1 Implement `src/lib/clients/eml-dataset.client.js`: given a folder path, list each
      immediate subfolder as a bucket, read every `.eml` file in it, and for each run
      `mailparser`'s `simpleParser` once to build `{uid: "<bucket>/<filename>", envelope:
      {from, to, subject, date}, raw}` (envelope shaped like ImapFlow's, per design.md).
      Throw a clear error if the given path does not exist or is not a directory.
- [x] 2.2 Verify via manual test against the existing `.temp/messages/ham` and
      `.temp/messages/spam` folders (4 files each) that all 8 files are loaded with correct
      bucket names and non-empty envelopes

## 3. Classification step

- [x] 3.1 Implement `src/lib/controllers/steps/classify-dataset.step.js`: for each loaded
      message, call `extractAiContent` (unmodified, from `ai-content.service.js`) then
      `classifyEmail` (unmodified, from `ai.client.js`), bounded by `mapWithConcurrency` and
      `ctx.config.AI_CONCURRENCY`, catching per-message errors so one failure doesn't abort
      the run (mirrors `classifyOne` in `ai-classification.step.js`)
- [x] 3.2 Unit test `test/unit/controllers/steps/classify-dataset.step.test.js` mocking
      `ai.client.js`'s `classifyEmail`: verify concurrency is bounded, a single message
      failure is recorded without aborting the batch, and successful results carry
      `{bucket, filename, score, reasoning}`

## 4. Report formatting service

- [x] 4.1 Implement `src/lib/services/prompt-eval-report.service.js`: pure function taking
      classified results (grouped by bucket) plus an AI config snapshot
      (`{model, maxInputTokens, maxOutputTokens, escalateToLowThreshold,
      escalateToHighThreshold, concurrency}`), returning report text with a config header,
      one section per bucket (filename/score/reasoning or failure per line), and a
      per-bucket summary (count, avg, min, max)
- [x] 4.2 Unit test `test/unit/services/prompt-eval-report.service.test.js` with zero mocks:
      verify header includes the config snapshot, bucket sections list every entry, summary
      stats are computed correctly, a bucket with zero entries renders without error, and a
      failed entry is shown distinctly from a scored one

## 5. Report file output

- [x] 5.1 Implement `src/lib/clients/report-file.client.js`: write given report text to
      `.temp/reports/<ISO-timestamp>.txt` and return the written path
- [x] 5.2 Unit test (or step-level test covering this) verifying two consecutive writes
      produce two distinct files, neither overwriting the other

## 6. Workflow controller

- [x] 6.1 Implement `src/lib/controllers/workflows/prompt-eval.controller.js`: `ctx`
      trailing parameter defaulted to `createDefaultContext()`, takes `{datasetPath}`, loads
      the dataset (step 2), classifies it (step 3), formats the report (step 4), writes it
      (step 5), and returns `{reportPath, bucketCounts}`
- [x] 6.2 Unit test `test/unit/controllers/workflows/prompt-eval.controller.test.js` mocking
      `eml-dataset.client.js`, `ai.client.js`, and `report-file.client.js` via
      `fixtureContext()`: verify the controller wires load -> classify -> format -> write in
      order and surfaces the written report path

## 7. CLI entry script

- [x] 7.1 Implement `src/cli/eval-prompt.js`: read the dataset folder path from
      `process.argv`, call `prompt-eval.controller.js`, print the written report path to
      stdout; exit non-zero with a clear message if no folder path is given or the folder is
      invalid
- [x] 7.2 Verify `node src/cli/eval-prompt.js .temp/messages` runs end-to-end against the
      existing 8 `ham`/`spam` fixture files with `AI_ENABLED=true` and real `.env`
      credentials, and produces a timestamped report in `.temp/reports/`

## 8. Documentation

- [x] 8.1 Document the new CLI usage (command, expected folder layout, where reports land)
      in `README.md`, and confirm no new environment variables were introduced (so
      `.env.example` needs no changes) per project convention

## 9. Prompt-engineer skill

- [x] 9.1 Create `.claude/skills/prompt-engineer/SKILL.md` per the project's skill
      conventions: instructs Claude Code to read the most recent (or user-specified) report
      file(s) from `.temp/reports/`, analyze per-bucket score/reasoning patterns, and edit
      only `buildSystemPrompt()` in `src/lib/clients/ai.client.js`, surfacing (not applying)
      any suggestion that would require a non-prompt change, per the `ai-prompt-engineer`
      spec
- [x] 9.2 Verify the skill is discoverable (appears in the available-skills listing) and, on
      a dry run with an existing report, produces a prompt edit plus an explanation citing
      specific report entries

## 10. First real tuning iteration (manual, user-driven)

- [x] 10.1 Once `.temp/messages/marketing/` has been populated with real labeled examples,
      run `src/cli/eval-prompt.js` against `.temp/messages`, invoke the `prompt-engineer`
      skill on the resulting report, and confirm a second run's report shows improved
      per-bucket calibration compared to the first - **not run as part of this change's
      automated implementation; performed by the user once test data is in place**
