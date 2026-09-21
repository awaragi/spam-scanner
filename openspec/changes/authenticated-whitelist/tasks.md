# Tasks

## 1. Extract the authentication signal from rspamd's response

- [x] 1.1 In `src/lib/utils/email-parser.util.js`, update `parseRspamdOutput` to also
      return `isSenderAuthenticated: boolean`, computed from `response.symbols` containing
      `R_DKIM_ALLOW` or `DMARC_POLICY_ALLOW` (not `DMARC_POLICY_ALLOW_WITH_FAILURES`).
      Handle `symbols` being an object keyed by symbol name (rspamd's actual `/checkv2`
      shape) and being absent entirely (treat as unauthenticated, not an error). Update the
      function's docstring, which currently states symbols are unused. Verify with
      `npm test -- email-parser.util` covering: DKIM-only pass, DMARC-only pass, both
      present, `DMARC_POLICY_ALLOW_WITH_FAILURES` only (must be unauthenticated), neither
      present, `symbols` missing entirely.
- [x] 1.2 In `src/lib/controllers/steps/rspamd-check.step.js`, thread
      `isSenderAuthenticated` from `parseRspamdOutput`'s result onto `spamInfo` alongside
      `score`/`required`. Verify with `npm test -- rspamd-check.step`.

## 2. Gate the whitelist score adjustment on authentication

- [x] 2.1 In `src/lib/services/spam-classifier.service.js`, update
      `applyWhitelistAdjustment(rawScore, isWhitelisted, isSenderAuthenticated)` (or
      equivalent signature) to subtract 20 when whitelisted AND authenticated, 5 when
      whitelisted but not authenticated, and 0 otherwise. Verify with
      `npm test -- spam-classifier.service` covering all three cases.
- [x] 2.2 Update `applyWhitelistAdjustments` (the batch/message-mapping counterpart) to read
      `message.spamInfo.isSenderAuthenticated` (set by task 1.2) and pass it through to
      `applyWhitelistAdjustment`, and to stamp `isSenderAuthenticated` onto the returned
      `spamInfo` alongside the existing `isWhitelisted`. Verify with the same test file.

## 3. Gate the AI-skip on authentication

- [x] 3.1 Update `partitionByWhitelistFlag` in `spam-classifier.service.js` to partition on
      `message.spamInfo?.isWhitelisted && message.spamInfo?.isSenderAuthenticated` instead
      of `isWhitelisted` alone. Verify with `npm test -- spam-classifier.service` covering:
      authenticated+whitelisted (held back), unauthenticated+whitelisted (not held back,
      goes to `rest`), non-whitelisted (goes to `rest`, unchanged).
- [x] 3.2 Confirm no change is needed in `src/lib/controllers/workflows/scan.controller.js`
      itself (it calls `partitionByWhitelistFlag`/`mergeWhitelistedBack` generically and
      shouldn't need to know about authentication) - run
      `npm test -- scan.controller` and confirm existing tests still pass; add a case if
      the controller test currently asserts on whitelist-skip behavior directly rather than
      through a mock of `partitionByWhitelistFlag`.

## 4. Test fixtures and full suite

- [x] 4.1 Update `test/support/fixtures.js` (or wherever a sample rspamd `/checkv2`
      response fixture lives) to support both an authenticated and unauthenticated
      `symbols` shape, so downstream controller/step tests can exercise both without
      hand-rolling the shape each time.
- [x] 4.2 Run `npm test`, `npm run lint`, and `npm run format:check`; all SHALL pass with
      zero regressions in previously-passing tests.

## 5. Spec sync and documentation

- [x] 5.1 Update `README.md`'s "Whitelist & Blacklist" section to describe the
      authentication requirement and the −20/−5 split (it currently states a flat −20 with
      no authentication mention).
- [ ] 5.2 Run `openspec archive authenticated-whitelist` (or the `openspec-archive-change`
      skill) once tasks above are complete and verified, to sync the `sender-lists` and
      `scan-inbox` deltas into `openspec/specs/`.
