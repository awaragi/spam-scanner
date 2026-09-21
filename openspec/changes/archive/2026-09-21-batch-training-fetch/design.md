# Design

## Context

See `proposal.md` - Why. Relevant current state:

- `scan.controller.js`'s `runScan` already does search-then-batch-fetch:
  `locatePendingMessages` (`pending-messages.step.js`) calls `search(imap, query)`
  to get UIDs cheaply, then `runScan` loops `uids` in `cfg.PROCESS_BATCH_SIZE` chunks,
  calling `fetchMessagesByUIDs(imap, batchUids)` per chunk. This change gives
  training the same shape.
- `search(imap, query)` in `imap.client.js` wraps `imap.search(query, {uid: true})`.
  ImapFlow's search query object supports `{ all: true }` as the "ALL messages"
  criteria (equivalent to the training workflows' current `1:*` fetch range).
- `fetchMessagesByUIDs(imap, uids)` already fetches `{uid, source, envelope,
  bodyStructure, flags}` per UID batch and runs each through `processMessage` -
  this is reused as-is for spam/ham training (which needs the full source for
  rspamd's learn call).
- `extractSenderAddresses`/`extractSenders` (`sender-lists.service.js`) read only
  `message.uid` and `message.headers[...]` (`from`, `reply-to`, `return-path`,
  `sender`) - confirmed by reading both functions. `moveMessages`/`updateLabels`
  (the only other things map training does with a fetched message) only read
  `message.uid`. So map training's fetched message object never needs to be more
  than `{uid, headers}`.
- `processMessage(message)` (`imap.client.js`) unconditionally does
  `message.source.toString()` - it assumes a source-bearing fetch and can't be
  reused as-is for a headers-only fetch (`message.source` would be `undefined`).
- ImapFlow's fetch query supports a `headers: true` option that returns only the
  header block as a `Buffer` (`message.headers`), separate from and much cheaper
  than `source: true` (RFC 3501 `BODY[HEADER]` vs `BODY[]`).
- `parseEmail(rawEmail)` (`email-parser.util.js`) splits on the first `\r?\n\r?\n`
  it finds to separate headers from body; fed a headers-only buffer with no
  trailing blank line, it would find no boundary at all (`headerEndIndex === -1`)
  and treat the whole buffer as body instead of headers - it needs a boundary to
  find.

## Goals / Non-Goals

**Goals:**

- Bound in-memory/in-flight message data during training to `PROCESS_BATCH_SIZE`
  messages' worth, matching the scan workflow's existing bound.
- Make a training run's partial progress (already-trained/moved batches) survive a
  later batch's fetch failure.
- Stop over-fetching for map training (headers only, not full source/body).

**Non-Goals:**

- Not changing `batch-processing-resilience`'s per-batch failure-isolation or
  transient/permanent error classification - those requirements govern what
  happens once a batch's messages are in hand; this change only narrows how many
  messages (and how much of each) are in hand at once.
- Not changing `PROCESS_BATCH_SIZE`'s default or semantics.
- Not changing `runMapTraining`'s existing error-propagation behavior (it currently
  rethrows on error, unlike `runTraining`, which swallows) - preserved as-is; not
  this change's concern to reconcile.

## Decisions

**Reuse `fetchMessagesByUIDs` as-is for spam/ham training; add a new
`fetchMessageHeadersByUIDs` for map training, rather than one parameterized
fetch function.** The two need genuinely different ImapFlow fetch queries
(`source: true, envelope: true, bodyStructure: true, flags: true` vs. just
`headers: true`) and produce differently-shaped message objects (`processMessage`'s
full shape vs. a `{uid, headers}` pair) - a single function branching on a "how much
to fetch" flag would need to return two different shapes from one call site,
which is more confusing than two small, clearly-named functions. Alternative
considered: one `fetchMessagesByUIDs(imap, uids, { headersOnly })` - rejected for
the shape-branching reason above.

**New `processMessageHeaders(message)` helper, parallel to the existing
`processMessage(message)`, rather than reusing `processMessage`.**
`processMessage` unconditionally reads `message.source` and `message.envelope`,
neither present on a headers-only fetch response; forcing it to handle both shapes
would add conditionals to a function every source-fetching caller also relies on.
`processMessageHeaders` appends `\r\n\r\n` to the fetched header buffer before
calling the existing `parseEmail` - a no-op if the buffer already ends in a blank
line (the regex finds the first boundary either way), and a correctness fix if it
doesn't, so `parseEmail` always finds a boundary and returns `{headers: {...},
body: ''}` rather than misreading a boundary-less buffer as an all-body, no-headers
message.

**`runTraining`/`runMapTraining` keep the existing `count(box)` empty-folder
fast path before searching.** `open()`'s `mailboxOpen` response already reports
`exists` at zero extra IMAP round-trip cost; skipping straight to `search` for an
empty folder would just replace one free check with an unnecessary one. Only when
`count(box) > 0` does the workflow search UIDs and enter the batch loop.

## Risks / Trade-offs

- [More IMAP round trips per training run (one search + N batch fetches, vs. one
  fetch)] → Matches the scan workflow's already-accepted trade-off of round-trips
  for bounded memory/resumability; `PROCESS_BATCH_SIZE` (default 10) keeps the
  batch count reasonable for the bulk-drag-a-few-thousand-messages case this
  finding is about.
- [`processMessageHeaders`'s `\r\n\r\n`-append approach to `parseEmail` boundary
  detection depends on `parseEmail`'s specific "first blank line wins" parsing
  rule] → Verified by reading `parseEmail`'s implementation directly (not assumed);
  the append is a no-op when a boundary already exists and a fix when it doesn't,
  so it's correct under either server behavior without needing to know which one a
  given IMAP server returns.

## Migration Plan

No data or state-format changes - this only changes how training workflows fetch
message content mid-run. Rollback is a plain revert.
