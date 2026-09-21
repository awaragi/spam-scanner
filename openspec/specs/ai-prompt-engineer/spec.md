# ai-prompt-engineer Specification

## Purpose

A Claude Code skill that reads `ai-prompt-eval` reports and edits the production AI
classifier's system prompt to reduce observed per-bucket miscalibration, leaving every
change as a normal, reviewable source edit rather than an opaque automated rewrite.

## Requirements

### Requirement: Reads eval reports as its evidence
The skill SHALL take one or more report files (from the reports folder given to the eval
CLI's `--reports` argument, by convention `.temp/reports/`) as its input and SHALL base its
analysis on their per-bucket scores and reasoning text, rather than re-running
classification itself or reasoning from general spam-domain knowledge unconnected to the
report contents.

#### Scenario: Skill invoked after an eval run
- **WHEN** the skill is invoked and one or more report files exist in the reports folder
- **THEN** the skill reads the report contents and cites specific bucket results (e.g. a
  named file's score and reasoning) to justify any prompt change it makes

#### Scenario: No report available
- **WHEN** the skill is invoked and the reports folder has no report files
- **THEN** the skill does not fabricate findings or edit the prompt, and instead tells the
  user to run the eval CLI first

### Requirement: Edit scope limited to the system prompt
The skill SHALL only edit `buildSystemPrompt()` in `src/lib/clients/ai.client.js`. If the
skill judges that a fix requires changing anything else (another file, an `AI_*`
environment/config value, dataset contents), it SHALL surface that as a suggestion to the
user instead of making the edit itself.

#### Scenario: Fix requires only prompt wording
- **WHEN** the report shows legitimate mail scoring too high and the skill determines the
  from-address signal is underused in the prompt
- **THEN** the skill edits `buildSystemPrompt()` in `src/lib/clients/ai.client.js` to
  strengthen that signal, and makes no other file edits

#### Scenario: Fix would require a non-prompt change
- **WHEN** the skill judges that the real fix is a config change (e.g. adjusting
  `AI_ESCALATE_TO_LOW_THRESHOLD`) rather than prompt wording
- **THEN** the skill states that recommendation to the user instead of editing `.env` or
  `config.js` itself

### Requirement: Edits are reviewable, not silent
The skill SHALL make its edits as ordinary file changes that appear in `git diff`, and
SHALL explain in its response what it changed and which report evidence motivated the
change, so the user can review and revert the edit like any other code change.

#### Scenario: Skill completes a prompt edit
- **WHEN** the skill finishes editing the prompt
- **THEN** the change is visible via `git diff` on `src/lib/clients/ai.client.js`, and the
  skill's response names the specific bucket/example evidence behind the edit
