# config-validation Specification

## Purpose

Governs how environment-variable-sourced configuration is validated: what a declarative schema checks, when each check runs (at module load vs. an explicit operator-facing startup check), and what a caller sees when validation fails - so misconfiguration is caught early with a complete, readable list of problems instead of one cryptic failure at a time.

## Requirements

### Requirement: A declarative schema is the single source of truth for configuration shape

The system SHALL describe every environment-variable-sourced configuration field in one
declarative schema (name, type, default, allowed values where applicable, and whether the
field has no safe default and must be supplied by the operator), rather than validating
each field ad hoc at its point of use.

#### Scenario: Schema drives validation, not scattered checks

- **WHEN** a configuration field's type, default, or allowed values need to change
- **THEN** that change SHALL be made in the schema, not in multiple ad hoc parsing sites across the codebase

### Requirement: Load-time validation checks every field it can safely check without operator-supplied secrets

At module load, the system SHALL validate every configuration field whose validity doesn't
depend on a value with no safe default (i.e., every field that has a default, or whose
requiredness is conditional on another field that itself has a safe default, such as
`AI_MODEL` being required only when `AI_ENABLED=true`). This SHALL include: every numeric
field parses as a real integer (not `NaN`); `SPAM_PROCESSING_MODE` is one of its allowed
values; `AI_API_KEY` is present when `AI_ENABLED=true` and `AI_BASE_URL` is still the
default OpenAI endpoint; `AI_ESCALATE_TO_LOW_THRESHOLD` does not exceed
`AI_ESCALATE_TO_HIGH_THRESHOLD`.

#### Scenario: A non-numeric value for a numeric field is rejected

- **WHEN** a configuration field declared as numeric in the schema (e.g. `SCAN_INTERVAL`) is set to a non-numeric string (e.g. `"5m"`)
- **THEN** loading configuration SHALL fail with an error identifying that field, rather than silently producing `NaN`

#### Scenario: An invalid SPAM_PROCESSING_MODE is rejected at load, not at first scan

- **WHEN** `SPAM_PROCESSING_MODE` is set to a value other than `label` or `folder`
- **THEN** loading configuration SHALL fail with an error identifying the invalid value, before any training or scanning occurs

#### Scenario: AI enabled against the default endpoint with no API key is rejected

- **WHEN** `AI_ENABLED=true`, `AI_BASE_URL` is unset (or explicitly set to the default OpenAI endpoint), and `AI_API_KEY` is unset
- **THEN** loading configuration SHALL fail with an error naming `AI_API_KEY`

#### Scenario: AI enabled against a non-default endpoint does not require an API key

- **WHEN** `AI_ENABLED=true`, `AI_BASE_URL` is set to a non-default value (e.g. a local Ollama endpoint), and `AI_API_KEY` is unset
- **THEN** loading configuration SHALL NOT fail on account of the missing `AI_API_KEY`

#### Scenario: Inverted AI escalation thresholds are rejected

- **WHEN** `AI_ESCALATE_TO_LOW_THRESHOLD` is set higher than `AI_ESCALATE_TO_HIGH_THRESHOLD`
- **THEN** loading configuration SHALL fail with an error identifying both values

### Requirement: Load-time validation reports every problem found, not just the first

When more than one load-time check fails, the system SHALL collect all of the failures and
report them together in a single error, rather than stopping at the first failure -
so a misconfigured deployment can fix everything in one pass instead of one restart per
problem.

#### Scenario: Multiple simultaneous misconfigurations are all reported

- **WHEN** both `SCAN_INTERVAL` is non-numeric and `SPAM_PROCESSING_MODE` is invalid at the same time
- **THEN** the resulting error SHALL mention both problems, not only whichever was checked first

### Requirement: Fields with no safe default are validated by an explicit startup check, not at module load

Configuration fields that have no safe default and must be supplied by the operator
(`IMAP_HOST`, `IMAP_USER`, `IMAP_PASSWORD`) SHALL be validated by an explicitly-invoked
check, separate from the checks that run unconditionally when configuration is loaded -
so that importing the configuration module never fails merely because these
operator-supplied values are absent in a context that doesn't need them (for example, a
test or tool that doesn't connect to IMAP). Every command-line entry point that does
connect to IMAP SHALL invoke this check once at startup, before doing any other work, and
SHALL fail with a clear, complete list of every missing required field if the check fails.

#### Scenario: Importing configuration never fails on missing IMAP credentials alone

- **WHEN** configuration is loaded (imported) in an environment where `IMAP_HOST`, `IMAP_USER`, and `IMAP_PASSWORD` are all unset
- **THEN** loading configuration SHALL succeed (assuming no other load-time check fails)

#### Scenario: An entry point that needs IMAP fails clearly and immediately when credentials are missing

- **WHEN** a command-line entry point that connects to IMAP is started with `IMAP_HOST`, `IMAP_USER`, or `IMAP_PASSWORD` unset
- **THEN** the entry point SHALL fail at startup, before connecting to IMAP, with an error naming every missing required field

#### Scenario: All missing required fields are reported together

- **WHEN** an entry point is started with both `IMAP_HOST` and `IMAP_PASSWORD` unset
- **THEN** the startup failure SHALL name both fields, not only one

### Requirement: SCAN_INTERVAL is read once through the configuration module

`SCAN_INTERVAL` SHALL be read from the environment exactly once, inside the configuration
module, like every other configuration value - not read directly from `process.env` at its
point of use.

#### Scenario: SCAN_INTERVAL is available on the configuration object

- **WHEN** any code needs the configured scan interval
- **THEN** it SHALL read it from the configuration module's exported value, not from `process.env.SCAN_INTERVAL` directly
