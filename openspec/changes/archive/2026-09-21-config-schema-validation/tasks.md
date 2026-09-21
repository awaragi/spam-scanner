# Tasks

## 1. Build the schema and validation core

- [x] 1.1 In `src/lib/core/config.js`, add a schema table (array of
      `{ key, type, default, required, allowedValues, secret, validate }` entries, per
      design.md) covering every existing config field, including `SCAN_INTERVAL` (moved in
      from `orchestrator.js` - same name, same `-1` default meaning single-run). Verify by
      inspecting the table covers every field currently read via `process.env.X` in
      `config.js` today (grep `process.env` in the file before/after and confirm no field
      was dropped).
- [x] 1.2 Implement the load-time validation pass: build `config` from the schema
      (type-coerce, apply defaults), then run every check whose validity doesn't depend on
      a field with no safe default (numeric parse-as-integer, `SPAM_PROCESSING_MODE` enum,
      `AI_MODEL`-required-when-enabled (existing), `SCAN_INITIAL_STATE` enum (existing),
      `AI_API_KEY`-required-when-enabled-against-default-endpoint, escalation threshold
      ordering), collecting every failure into an array instead of throwing on the first.
      If any failures were collected, throw one `Error` joining all `{field, message}`
      entries. Verify with `npm test -- config.test` (existing tests must still pass
      unmodified except the one noted in task 4.1).
- [x] 1.3 Implement `assertRequiredConfig(cfg = config)`, exported from `config.js`,
      checking `IMAP_HOST`/`IMAP_USER`/`IMAP_PASSWORD` are all non-empty, collecting every
      missing field and throwing one `Error` naming all of them if any are missing. Verify
      with new tests in `test/unit/core/config.test.js` (task 4.2).

## 2. Fix the SCAN_INTERVAL bug and layering violation

- [x] 2.1 In `src/cli/orchestrator.js`, remove `const scanInterval = parseInt(process.env.SCAN_INTERVAL || '-1', 10);` and use `config.SCAN_INTERVAL` (from task 1.1) everywhere `scanInterval` was used. Verify: `grep -n "process.env" src/cli/orchestrator.js` returns nothing.
- [x] 2.2 Replace `orchestrator.js`'s existing `if (!config.IMAP_HOST) {...}` /
      `if (!config.IMAP_USER) {...}` block with a single `assertRequiredConfig()` call
      (still followed by `process.exit(1)` in a catch, or equivalent, so the CLI still
      exits cleanly rather than crashing with a raw stack trace). Verify with
      `npm test -- ` (no dedicated orchestrator startup test exists per ROADMAP.md 5.16;
      manually confirm by running `node src/cli/orchestrator.js` with no `.env` and
      checking the printed error lists all three IMAP fields, not just two).

## 3. Add assertRequiredConfig() to every IMAP-touching entry point

- [x] 3.1 Add `assertRequiredConfig()` (called immediately after importing `config.js`,
      before any other top-level code) to every `src/cli/*.js` entry point that connects to
      IMAP: `init-folders.js`, `scan-inbox.js`, `train-blacklist.js`, `train-ham.js`,
      `train-spam.js`, `train-whitelist.js` (NOT `eval-prompt.js` - it doesn't touch IMAP).
      Scripts that don't currently import `config.js` gain the import. Verify: each script
      still runs its existing manual/smoke-test path unchanged when `.env` is valid.
- [x] 3.2 Add the same to every `src/admin/*.js` script that connects to IMAP:
      `delete-state.js`, `export-list.js`, `export-mailbox-state.js`, `import-list.js`,
      `import-mailbox-state.js`, `list-all.js`, `read-email.js`, `read-state.js`,
      `reset-state.js`, `uid-on-date.js`, `write-state.js`. Verify the same way.

## 4. Test coverage

- [x] 4.1 Update the existing `test/unit/core/config.test.js` test "does not throw when
      AI_ENABLED=true and AI_MODEL is set" to also set `process.env.AI_API_KEY` (it would
      now fail under the new AI_API_KEY-required-against-default-endpoint check without
      this). Verify with `npm test -- config.test`.
- [x] 4.2 Add new tests to `config.test.js` covering: a non-numeric `SCAN_INTERVAL` throws
      naming the field; an invalid `SPAM_PROCESSING_MODE` throws naming the field;
      `AI_ENABLED=true` with no `AI_API_KEY` and default `AI_BASE_URL` throws;
      `AI_ENABLED=true` with no `AI_API_KEY` but a non-default `AI_BASE_URL` does NOT
      throw; `AI_ESCALATE_TO_LOW_THRESHOLD` > `AI_ESCALATE_TO_HIGH_THRESHOLD` throws;
      multiple simultaneous failures are all named in one thrown error's message;
      `assertRequiredConfig()` throws naming all of `IMAP_HOST`/`IMAP_USER`/
      `IMAP_PASSWORD` when all three are unset, and does not throw when all three are set;
      importing `config.js` itself never throws merely because IMAP credentials are unset.
      Verify with `npm test -- config.test`.
- [x] 4.3 Run `npm test`, `npm run lint`, and `npm run format:check` for the full suite;
      all SHALL pass with zero regressions in previously-passing tests outside the one
      intentionally-updated test in task 4.1.

## 5. Documentation

- [x] 5.1 Update `.env.example`'s `SCAN_INTERVAL` comment and `README.md` wherever
      `SCAN_INTERVAL` or config validation is discussed, to note it's now validated (still
      the same variable name, same semantics - no rename per design.md).
- [ ] 5.2 Run `openspec archive config-schema-validation` (or the
      `openspec-archive-change` skill) once tasks above are complete and verified, to sync
      the new `config-validation` capability into `openspec/specs/`.
