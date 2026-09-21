# Proposal

## Why

`train.controller.js`'s `runTraining` (spam/ham) and
`sender-list-training.controller.js`'s `runMapTraining` (whitelist/blacklist) both
call `fetchAllMessages(imap)`, which downloads the full RFC822 source of every
message in the training folder into memory in one shot, before any batching or
processing happens (verified: `fetchAllMessages` fetches `1:*` with
`source: true, envelope: true, bodyStructure: true, flags: true` for the whole
folder). The scan workflow already avoids this (`locatePendingMessages` searches
UIDs cheaply, then `runScan` fetches and processes `PROCESS_BATCH_SIZE` UIDs at a
time via `fetchMessagesByUIDs`) - training never adopted the same pattern.

A user bulk-dragging a few thousand old spam/ham messages into a training folder -
a very natural first action when setting up the filter - can exhaust container
memory before a single message is trained, and a failure partway through
(`fetchAllMessages` itself throwing, e.g. a dropped connection) discards the whole
download and starts over next cycle rather than resuming past whatever was already
fetched.

Separately, whitelist/blacklist training
(`extractSenderAddresses`/`extractSenders` in `sender-lists.service.js`) only ever
reads `message.uid` and `message.headers` (specifically the `from`/`reply-to`/
`return-path`/`sender` header fields) - never `raw`, `body`, `envelope`, or
`bodyStructure`. Fetching full message sources for map training downloads far more
than it needs.

## What Changes

- `train.controller.js`'s `runTraining` (spam/ham): replace the single
  `fetchAllMessages` call with search-then-batch-fetch, mirroring
  `scan.controller.js`'s existing pattern - search all UIDs in the folder once
  (cheap), then fetch/train/move `PROCESS_BATCH_SIZE` UIDs at a time via the
  existing `fetchMessagesByUIDs`. A failure fetching one batch no longer discards
  batches already trained and moved earlier in the same run.
- `sender-list-training.controller.js`'s `runMapTraining` (whitelist/blacklist):
  same search-then-batch-fetch restructuring, but fetching only message headers per
  batch (a new, cheaper client primitive) instead of full sources - map training
  never needed the body.
- Remove `fetchAllMessages` from `imap.client.js` once both callers are migrated -
  it has no remaining callers.
- No change to `PROCESS_BATCH_SIZE`'s meaning or default, and no change to the
  existing per-batch failure-isolation/error-classification behavior
  (`batch-processing-resilience`) - this change is purely about how much is fetched
  into memory before that existing per-batch logic runs, not about how failures
  within a batch are handled.

## Capabilities

### New Capabilities

- `bounded-training-fetch`: training and map-training workflows fetch messages in
  `PROCESS_BATCH_SIZE`-sized chunks (searched UIDs first, fetched per batch) rather
  than downloading an entire folder's messages upfront, and map training fetches
  only headers rather than full message sources.

### Modified Capabilities

(none - `batch-processing-resilience`'s per-batch failure-isolation and
transient/permanent classification requirements are unaffected; only the
fetch-time granularity changes, which `bounded-training-fetch` covers as a new,
narrower concern)

## Impact

- `src/lib/clients/imap.client.js` - add `fetchMessageHeadersByUIDs`; remove
  `fetchAllMessages`.
- `src/lib/controllers/workflows/train.controller.js` - search-then-batch-fetch for
  `runTraining`.
- `src/lib/controllers/workflows/sender-list-training.controller.js` -
  search-then-batch-fetch (headers-only) for `runMapTraining`.
- Test files for both controllers, plus `test/support/fake-clients.js` (the fake
  IMAP client factory needs the new/removed function names kept in sync).
