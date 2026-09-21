# Spec Delta

## Purpose

Offline batch classification of a labeled `.eml` dataset against the current AI classifier
configuration, producing a timestamped, comparable text report used to measure and iterate
on classifier accuracy before changing production behavior.

## ADDED Requirements

### Requirement: Per-bucket folder arguments
The CLI SHALL accept one named argument per bucket (`--ham`, `--marketing`, `--spam`), each
giving a filesystem folder path holding `.eml` files for that bucket. At least one bucket
argument SHALL be given. The CLI SHALL classify every `.eml` file found in each given
folder, grouped under the argument's bucket name (not the folder's own basename), so a
folder can live at any path.

#### Scenario: Multiple bucket arguments given
- **WHEN** the CLI is run with `--ham <folder>`, `--marketing <folder>`, and `--spam
  <folder>`, each folder holding `.eml` files
- **THEN** every `.eml` file in each folder is classified and included in the report,
  grouped under its argument's bucket name (`ham`, `marketing`, or `spam`)

#### Scenario: A single bucket argument given
- **WHEN** the CLI is run with only `--spam <folder>`
- **THEN** only that bucket is classified and reported; the run does not require the other
  buckets to be given

#### Scenario: No bucket argument given
- **WHEN** the CLI is run with none of `--ham`, `--marketing`, `--spam`
- **THEN** the CLI exits with a clear error message and does not produce a report

#### Scenario: Invalid or missing bucket folder path
- **WHEN** a given bucket argument's folder path does not exist or is not readable
- **THEN** the CLI exits with a clear error message and does not produce a report

### Requirement: Report location is a required argument
The CLI SHALL accept a mandatory `--reports` argument giving the folder to write the
timestamped report file to. There SHALL be no default report location - the caller always
states it explicitly.

#### Scenario: Report location omitted
- **WHEN** the CLI is run without `--reports`
- **THEN** the CLI exits with a clear error message before any classification happens

### Requirement: Production-equivalent parsing
The CLI SHALL extract each message's classification input (`from`, `to`, `subject`, `date`,
`text`) using the same parsing path the production scan workflow uses, so eval results
reflect what production would actually see, not a separately maintained parser.

#### Scenario: Multipart/HTML message parsed like production
- **WHEN** a `.eml` file contains a multipart MIME message with an HTML body
- **THEN** the extracted `text` content matches what the production extraction path would
  produce for the same raw message (HTML-stripped, transfer-encoding-decoded, token-budget
  truncated the same way)

### Requirement: Uses current production classifier unmodified
The CLI SHALL classify each message via the same classification entry point production
uses, reading AI credentials and configuration (model, token limits, thresholds, etc.) from
the same `.env`/config source as production, with no CLI-specific fork or override of the
prompt-building or classification logic.

#### Scenario: Prompt or model changed between runs
- **WHEN** the system prompt in `ai.client.js` or an `AI_*` config value (e.g. `AI_MODEL`)
  is changed between two CLI runs
- **THEN** the next run uses the updated prompt/config automatically, with no changes
  required to the CLI itself

### Requirement: Bounded concurrency
The CLI SHALL bound the number of concurrent classification requests using the existing
`AI_CONCURRENCY` configuration value, using the same concurrency mechanism already used for
production AI classification, regardless of dataset size.

#### Scenario: Large dataset respects concurrency limit
- **WHEN** the CLI is run against a dataset larger than `AI_CONCURRENCY`
- **THEN** at most `AI_CONCURRENCY` classification requests are in flight at any time

### Requirement: Per-message failure does not abort the run
A classification failure for one message (timeout, network error, malformed response, or
any other error) SHALL NOT abort the run. The failure SHALL be recorded against that
message in the report, and classification SHALL continue for the remaining messages.

#### Scenario: One message fails classification
- **WHEN** one `.eml` file's classification request fails
- **THEN** the report includes an entry for that file recording the failure, and every
  other file in the dataset is still classified and reported

### Requirement: Timestamped, non-overwriting report output
Each run SHALL write its results to a new file under the given `--reports` folder, named
with a timestamp, rather than overwriting a fixed filename, so a report from an earlier run
remains available for comparison after a later run.

#### Scenario: Two runs in the same session
- **WHEN** the CLI is run twice with the same `--reports` folder, against the same or
  different bucket folders
- **THEN** two distinct timestamped files exist under that `--reports` folder afterward, and
  neither run's output overwrote the other's

### Requirement: Report records the AI configuration used
Each report SHALL include a header recording the AI configuration used for that run (at
minimum: model, max input tokens, max output tokens, escalation thresholds), so reports
remain comparable across runs even when something other than the prompt text changed.

#### Scenario: Config differs between two runs
- **WHEN** two runs are made with different `AI_MODEL` values
- **THEN** each run's report header records the model actually used for that run

### Requirement: Report grouped by bucket with per-bucket summary
Each report SHALL group results by bucket (the `--ham`/`--marketing`/`--spam` argument name
that supplied the folder), listing each message's filename, score, and reasoning (or
failure reason), followed by a per-bucket summary of count, average score, minimum score,
and maximum score.

#### Scenario: Bucket summary reflects its entries
- **WHEN** a bucket contains three successfully classified messages with scores 10, 20, and
  90
- **THEN** the report's summary line for that bucket shows count=3, and an average, min,
  and max consistent with those three scores
