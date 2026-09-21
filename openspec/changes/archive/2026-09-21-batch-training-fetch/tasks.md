# Tasks

## 1. New client primitive

- [x] 1.1 In `src/lib/clients/imap.client.js`, add `processMessageHeaders(message)`
      (returns `{uid, headers}`, parsing `message.headers.toString() + '\r\n\r\n'`
      via the existing `parseEmail`) and `fetchMessageHeadersByUIDs(imap, uids)`
      (fetches `{uid: true, headers: true}` per UID batch, mapping each result
      through `processMessageHeaders`), mirroring `processMessage`/
      `fetchMessagesByUIDs`'s existing shape and logging conventions.

## 2. Spam/ham training: search-then-batch-fetch

- [x] 2.1 In `src/lib/controllers/workflows/train.controller.js`'s `runTraining`,
      replace the single `fetchAllMessages(imap)` call with
      `search(imap, { all: true })` to get all UIDs, then loop UIDs in
      `PROCESS_BATCH_SIZE` chunks, calling `fetchMessagesByUIDs(imap, batchUids)`
      per chunk immediately before that chunk's existing train/move logic (folding
      the existing `messages.slice(...)` batching loop into the UID loop rather
      than keeping two separate loops).
- [x] 2.2 Update `test/unit/controllers/workflows/train.controller.test.js` to mock
      `search`/`fetchMessagesByUIDs` instead of `fetchAllMessages`, and add a test
      asserting more than `PROCESS_BATCH_SIZE` UIDs results in more than one
      `fetchMessagesByUIDs` call, each for at most `PROCESS_BATCH_SIZE` UIDs.

## 3. Whitelist/blacklist map training: search-then-batch-fetch, headers only

- [x] 3.1 In `src/lib/controllers/workflows/sender-list-training.controller.js`'s
      `runMapTraining`, replace the single `fetchAllMessages(imap)` call with
      `search(imap, { all: true })`, then loop UIDs in `PROCESS_BATCH_SIZE` chunks,
      calling `fetchMessageHeadersByUIDs(imap, batchUids)` per chunk and running
      the existing extract/update-list-state/tag/move logic against each chunk's
      messages (list-state updates accumulate correctly across chunks - append
      mode already merges with whatever's already in the IMAP-backed list, so
      per-chunk `updateListState` calls compose correctly).
- [x] 3.2 Update `test/unit/controllers/workflows/sender-list-training.controller.test.js`
      to mock `search`/`fetchMessageHeadersByUIDs` instead of `fetchAllMessages`,
      and add a test asserting more than `PROCESS_BATCH_SIZE` UIDs results in more
      than one `fetchMessageHeadersByUIDs` call.

## 4. Remove the now-unused full-folder fetch

- [x] 4.1 Remove `fetchAllMessages` from `src/lib/clients/imap.client.js` (no
      remaining callers after tasks 2 and 3) and its mock from
      `test/support/fake-clients.js`'s fake IMAP client factory; add
      `fetchMessageHeadersByUIDs` to that same factory.

## 5. Verification

- [x] 5.1 Add unit coverage for `processMessageHeaders`/`fetchMessageHeadersByUIDs`
      in `test/unit/clients/imap.client.test.js` (a boundary-less header buffer
      still parses correctly via the `\r\n\r\n` append).
- [x] 5.2 Run `npm test` and confirm all unit tests pass.
- [x] 5.3 Run `npm run lint` and `npm run format:check` and confirm both pass.
