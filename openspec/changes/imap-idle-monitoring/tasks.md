## 1. Update scan workflow return value

- [x] 1.1 Update `src/lib/workflows/scan-workflow.js` — change `run()` to return `{ processed: N }` where N is the count of messages fetched and processed (0 when no new messages found)
- [x] 1.2 Update `test/scan-workflow.test.js` — add assertions that `run()` returns `{ processed: N }` and `{ processed: 0 }` for the no-messages case

## 2. Create idle workflow

- [x] 2.1 Create `src/lib/workflows/idle-workflow.js` — export `runIdle(imap)` that opens a mailbox lock on `FOLDER_INBOX` in read-only mode, calls `imap.idle()`, and releases the lock in a `finally` block
- [x] 2.2 Create `test/idle-workflow.test.js` — unit test that verifies `runIdle` calls `imap.idle()` and releases the lock on both success and error

## 3. Add IDLE_MAX_RETRIES to config

- [x] 3.1 Add `IDLE_MAX_RETRIES` to `src/lib/utils/config.js` — parse from environment, default to `5`

## 4. Update orchestrator for IDLE mode

- [x] 4.1 Add IDLE mode branch to `src/orchestrator.js` — when `SCAN_INTERVAL === 0`, skip the poll loop and enter the IDLE loop instead
- [x] 4.2 Implement the IDLE loop — wrap each cycle in a retry handler: on error increment failure counter and apply exponential backoff (`min(2^n * 1000ms, 60000ms)`); on success reset counter to zero; exit with non-zero status when counter reaches `IDLE_MAX_RETRIES`
- [x] 4.3 Implement the cycle inside the IDLE loop — call `runStep(runIdle)` to wait for EXISTS, then run training steps (runSpam, runHam, runWhitelist, runBlacklist), then run the scan drain loop
- [x] 4.4 Implement the scan drain loop — call `runStep(runScan)` in a `do/while` loop, continuing while the returned `processed` count is greater than zero

## 5. Smoke test

- [ ] 5.1 Run locally with `SCAN_INTERVAL=0` and confirm: init runs once, IDLE enters, EXISTS notification triggers a full cycle (training + scan drain), IDLE re-enters after cycle
- [ ] 5.2 Confirm `SCAN_INTERVAL=-1` and `SCAN_INTERVAL=N` modes still behave as before
