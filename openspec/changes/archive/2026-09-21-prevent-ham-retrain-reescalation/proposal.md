# Proposal

## Why

Ham training (`train.ham`) and whitelist training (`train.whitelist`) both move the
trained message back to `FOLDER_INBOX` (`train.controller.js`'s `runHam`,
`sender-list-training.controller.js`'s `runWhitelist`). That message gets a new UID
greater than `state.last_uid`, so the scan workflow processes it again on the next
cycle. Bayes training lowers rspamd's own score, but the AI safety net
(`ai-spam-escalation`) is a separate, independent signal - if AI still scores the
content high enough, it escalates the message to `lowSpam`/`highSpam` regardless of
the training the user just performed. In `folder` mode the user watches the message
they just rescued from spam get moved right back out of `FOLDER_INBOX`. The same gap
applies to a whitelist-trained message when the specific trained message's sender
isn't authenticated (per `sender-lists`, an unauthenticated whitelist match doesn't
skip AI).

## What Changes

- Introduce a dedicated IMAP keyword flag (`$ScannerTrained`) that marks "a human just
  reviewed this exact message via a training folder - don't let the AI safety net
  escalate it again."
- `train.controller.js`'s ham training path tags each message with this flag before
  moving it from `train.ham` back to `FOLDER_INBOX`. Spam training (which moves to
  `FOLDER_SPAM`, never rescanned) is unaffected.
- `sender-list-training.controller.js`'s whitelist training path tags each message
  with this flag before moving it from `train.whitelist` back to `FOLDER_INBOX`.
  Blacklist training (which moves to `FOLDER_SPAM`) is unaffected.
- The scan workflow excludes any message carrying this flag from AI classification -
  it is scanned by rspamd as normal (so Bayes still applies) and keeps whatever tier
  its rspamd/whitelist-adjusted score alone produces, exactly like the existing
  authenticated-whitelist AI exemption, just via a different signal.
- The flag is scoped to the one retrained message, not the sender - later messages
  from the same sender are unaffected and go through AI normally.

## Capabilities

### New Capabilities

- `training-reescalation-guard`: owns the `$ScannerTrained` keyword flag - training
  workflows that reinject a message into `FOLDER_INBOX` after a positive training
  action set it, and the scan/AI-escalation workflow reads it as an AI exemption.

### Modified Capabilities

(none - `ai-spam-escalation`'s existing requirements about which buckets go to AI are
extended by the new capability's requirement, not altered)

## Impact

- `src/lib/controllers/workflows/train.controller.js` - tag-before-move for the ham
  path.
- `src/lib/controllers/workflows/sender-list-training.controller.js` - tag-before-move
  for the whitelist path.
- `src/lib/clients/imap.client.js` - reuses the existing `updateLabels` flag-add
  primitive; no new client code expected.
- `src/lib/controllers/workflows/scan.controller.js` /
  `src/lib/services/spam-classifier.service.js` - new partition/merge around the AI
  call, parallel to the existing whitelist-authenticated partition.
- No config/env var changes - the flag name is an internal implementation detail, not
  a user-facing label (unlike `LABEL_SPAM_LOW`/`LABEL_SPAM_HIGH`), so it is not made
  configurable.
