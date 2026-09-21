# Design

## Context

See `proposal.md` - Why. Relevant current state:

- `updateLabels(imap, messages, labelsToSet, labelsToUnset)` in `imap.client.js`
  already wraps `imap.messageFlagsAdd`/`messageFlagsRemove` and is the mechanism
  `label-apply.step.js` uses for `LABEL_SPAM_LOW`/`LABEL_SPAM_HIGH`. It works on any
  IMAP keyword string, not just the configured spam labels.
- `message.flags` (populated by `processMessage` in `imap.client.js`) is a
  `Set<string>` per message, already fetched on every `fetchAllMessages`/
  `fetchMessagesByUIDs` call but currently unused downstream.
- `scan.controller.js` already partitions `nonSpamMessages`/`lowSpamMessages` before
  the AI call via `partitionByWhitelistFlag`/`mergeWhitelistedBack`
  (`spam-classifier.service.js`) to hold back authenticated-whitelist matches from AI
  and merge them back into the same tier afterward. The new flag exemption follows
  the identical shape.
- `train.controller.js`'s `runTraining` is shared by both spam and ham training;
  `sender-list-training.controller.js`'s `runMapTraining` is shared by both whitelist
  and blacklist training. Both already move messages in a single batch call after
  processing.

## Goals / Non-Goals

**Goals:**

- Stop the independent AI safety net from re-escalating a message a human just
  trained as ham or whitelisted, on the very next scan pass.
- Keep the fix scoped to the single reinjected message, not its sender - a different
  future message from the same sender must still go through AI normally.
- Reuse existing primitives (`updateLabels`, the whitelist partition/merge pattern)
  rather than adding new IMAP client surface.

**Non-Goals:**

- Not solving IMAP-keyword-visibility-across-providers (roadmap 5.22) - this flag is
  purely internal bookkeeping, never shown to the user, so provider support for
  *displaying* keywords is irrelevant. Provider support for *setting* arbitrary
  keywords still matters (see Risks).
- Not deduplicating or ever clearing the flag once set - see Decisions.
- Not addressing blacklist/spam training (they never reinject into a scanned folder,
  so they're out of scope per the spec delta).

## Decisions

**One shared flag name (`$ScannerTrained`) for both ham and whitelist training,
rather than two.** Both cases need identical scan-side treatment (skip AI, keep
whatever tier the rspamd score alone produces). A single flag keeps the scan-side
check and the partition/merge code to one code path instead of two near-identical
ones. Alternative considered: separate `$ScannerHam`/`$ScannerWhitelisted` flags (as
the roadmap entry and 7.1.7 sketch) - rejected because nothing downstream needs to
distinguish which training path set the flag; it would just be two names for the same
behavior.

**Tag before move, in the training folder, via the existing `updateLabels`
primitive.** `runTraining`/`runMapTraining` already have the message list in hand
right before their `moveMessages` call. Setting the flag first (same connection, same
batch) means the flag is part of the message state `messageMove` (COPY+STORE+EXPUNGE
under the hood) carries across, rather than a second round-trip after the move.
Alternative considered: set the flag after the move, once the message is in
`FOLDER_INBOX` - rejected as an unnecessary extra IMAP round-trip with no benefit,
and a window where a scan running concurrently with training could see the message
before it's flagged.

**`runTraining` gains a boolean `tagAsTrained` parameter (default `false`), threaded
from `runHam`/`runSpam`; `runMapTraining` gains the same, threaded from
`runWhitelist`/`runBlacklist`.** Keeps `train.controller.js` and
`sender-list-training.controller.js`'s existing shared-helper shape (both already
parameterize destination folder and type per caller) rather than duplicating the
whole function body for the ham/whitelist cases. Alternative considered: always tag
in `runTraining`/`runMapTraining` unconditionally - rejected because it would also
flag spam/blacklist-trained messages, which is harmless today (they never reach the
scan workflow) but bakes in an incorrect invariant ("every trained message is
flagged") that would silently break if `FOLDER_SPAM` were ever scanned.

**Never clear the flag.** Once a message is confirmed ham/whitelisted by a human, it
stays exempt from AI re-escalation for its own lifetime in the mailbox - there's no
future point where it becomes correct to let AI escalate that exact message again.
Bayes and the whitelist itself remain the ongoing signal for *new* mail from the same
sender. Alternative considered: clear the flag after the first post-training scan
pass (so the exemption is "one scan only") - rejected as unnecessary complexity for
no behavioral benefit: the message's content never changes, so there's no future
scan where re-evaluating it via AI would produce a more correct result than the
rspamd/Bayes score already does.

**Partition/merge pattern mirrors `partitionByWhitelistFlag`/`mergeWhitelistedBack`
as a parallel pair (`partitionByTrainedFlag`/`mergeTrainedBack`), not a merged
single check.** Keeps each partition independently testable and matches the
project's existing pattern of one predicate per exemption reason. `scan.controller.js`
chains both partitions before the AI call and both merges after. Alternative
considered: fold the flag check into `partitionByWhitelistFlag` itself (one combined
"AI-exempt" partition) - rejected because it conflates two independently-reasoned
exemptions (a sender-level trust signal vs. a one-message training signal) into one
function, making both harder to test and reason about in isolation.

## Risks / Trade-offs

- [Server doesn't support arbitrary IMAP keywords (no `\*` in `PERMANENTFLAGS`)] →
  `messageFlagsAdd` for an unsupported flag is a no-op per IMAP semantics (ImapFlow
  doesn't error, the flag simply doesn't stick). Worst case on such a server: this
  fix has no effect and the pre-existing re-escalation behavior continues - no worse
  than today, and the same limitation already exists for `LABEL_SPAM_LOW`/
  `LABEL_SPAM_HIGH` in `label` mode, so no new provider-support surface.
- [`moveMessages`/`messageMove` doesn't preserve custom keywords across the move on
  some server] → Verify empirically during implementation (per `CLAUDE.md` "(verify)"
  convention) against the project's Dovecot-based local dev stack; IMAP `MOVE`
  (RFC 6851) and the COPY+STORE+EXPUNGE fallback ImapFlow uses both operate on the
  full message including flags, so this is expected to work, but isn't yet confirmed
  for this codebase's actual server.
- [Flag never clears → flag count grows unbounded on a long-lived mailbox] → Each
  flag is a few bytes on one message; IMAP servers handle keyword flags natively for
  exactly this kind of per-message metadata. Not a practical concern at mailbox scale.

## Migration Plan

No data migration - this only affects messages trained after the change ships.
Messages already sitting in `FOLDER_INBOX` from training that happened before this
change was deployed are not retroactively flagged; they remain subject to normal AI
re-evaluation on their next scan (there isn't one, since `last_uid` has already
advanced past them). Rollback is a plain revert - no state format changes.
