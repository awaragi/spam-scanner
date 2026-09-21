# Tasks

## 1. Training-side: tag the reinjected message

- [x] 1.1 In `src/lib/controllers/workflows/train.controller.js`, add a
      `tagAsTrained` parameter to `runTraining` (default `false`); when `true`, tag
      `[...learned, ...skipped]` with the `$ScannerTrained` flag (via
      `updateLabels`) before `moveMessages` runs. Wire `runHam` to pass `true` and
      `runSpam` to pass `false` (or omit).
- [x] 1.2 In `src/lib/controllers/workflows/sender-list-training.controller.js`, add
      the same `tagAsTrained` parameter to `runMapTraining`; when `true`, tag
      `messages` with the `$ScannerTrained` flag before `moveMessages` runs. Wire
      `runWhitelist` to pass `true` and `runBlacklist` to pass `false` (or omit).
- [x] 1.3 Update `test/unit/controllers/workflows/train.controller.test.js`: assert
      `runHam` tags moved messages with `$ScannerTrained` (both the learned and the
      permanently-failed-but-moved-on case) and `runSpam` does not tag at all.
- [x] 1.4 Update
      `test/unit/controllers/workflows/sender-list-training.controller.test.js`:
      assert `runWhitelist` tags moved messages with `$ScannerTrained` (both the
      sender-extracted and no-extractable-sender cases) and `runBlacklist` does not
      tag at all.

## 2. Scan-side: exempt flagged messages from AI

- [x] 2.1 In `src/lib/services/spam-classifier.service.js`, add
      `partitionByTrainedFlag(messages)` (checks `message.flags.has('$ScannerTrained')`)
      and `mergeTrainedBack(categorized, nonSpamTrained, lowSpamTrained)`, mirroring
      `partitionByWhitelistFlag`/`mergeWhitelistedBack`.
- [x] 2.2 Add unit tests in `test/unit/services/spam-classifier.service.test.js` for
      `partitionByTrainedFlag` (flagged vs. unflagged, missing `flags` field) and
      `mergeTrainedBack`, zero mocks per project convention.
- [x] 2.3 In `src/lib/controllers/workflows/scan.controller.js`'s `scanBatch`, chain
      `partitionByTrainedFlag` on each of `nonSpamPartition.rest`/
      `lowSpamPartition.rest` before the AI call, submit only the resulting
      `.rest` to `classifyWithAi`/`applyAiEscalation`, and merge
      `.trained` back in afterward via `mergeTrainedBack` (after the existing
      `mergeWhitelistedBack` call).
- [x] 2.4 Update `test/unit/controllers/workflows/scan.controller.test.js`: assert a
      `$ScannerTrained`-flagged message in the clean or low tier is never passed to
      the mocked AI client and keeps its rspamd-assigned tier even when the mock AI
      client would otherwise escalate it.

## 3. Verification

- [x] 3.1 Run `npm test` and confirm all unit tests pass, including the new/updated
      ones above.
- [ ] 3.2 Manually verify (per design.md's "(verify)" flag-preservation risk) against
      a real IMAP server: train a message as ham, confirm it lands in `FOLDER_INBOX`
      carrying the `$ScannerTrained` keyword, then run a scan cycle with
      `AI_ENABLED=true` and confirm it is not sent to the AI client. **Not run**:
      this repo has no disposable IMAP test server yet (`bin/local/docker-compose.yml`
      only brings up rspamd/redis/unbound - a Dovecot/GreenMail test server is
      exactly the unbuilt gap tracked by roadmap 5.16/5.29), and the only running
      spam-scanner container on this machine is the production stack pointed at the
      real mailbox - not something to run ad hoc training/scan cycles against as a
      test. Left for the user to verify against their own mailbox when convenient, or
      to fold into 5.16/5.29's future e2e test.
