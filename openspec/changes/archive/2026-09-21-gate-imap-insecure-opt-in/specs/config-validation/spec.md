# Spec Delta

## MODIFIED Requirements

### Requirement: Load-time validation checks every field it can safely check without operator-supplied secrets

At module load, the system SHALL validate every configuration field whose validity doesn't
depend on a value with no safe default (i.e., every field that has a default, or whose
requiredness is conditional on another field that itself has a safe default, such as
`AI_MODEL` being required only when `AI_ENABLED=true`). This SHALL include: every numeric
field parses as a real integer (not `NaN`); `SPAM_PROCESSING_MODE` is one of its allowed
values; `AI_API_KEY` is present when `AI_ENABLED=true` and `AI_BASE_URL` is still the
default OpenAI endpoint; `AI_ESCALATE_TO_LOW_THRESHOLD` does not exceed
`AI_ESCALATE_TO_HIGH_THRESHOLD`; `IMAP_TLS=false` is accompanied by
`IMAP_ALLOW_INSECURE=true`.

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

#### Scenario: IMAP_TLS disabled without the insecure opt-in is rejected

- **WHEN** `IMAP_TLS` is set to `false` and `IMAP_ALLOW_INSECURE` is unset or not `true`
- **THEN** loading configuration SHALL fail with an error naming `IMAP_ALLOW_INSECURE`

#### Scenario: IMAP_TLS disabled with the insecure opt-in succeeds

- **WHEN** `IMAP_TLS` is set to `false` and `IMAP_ALLOW_INSECURE` is set to `true`
- **THEN** loading configuration SHALL succeed (assuming no other load-time check fails)
