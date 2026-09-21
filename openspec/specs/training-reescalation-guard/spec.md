# training-reescalation-guard Specification

## Purpose

Prevents a message a user just rescued via ham or whitelist training from being
re-escalated by the independent AI safety net on the very next scan pass, by marking
that specific reinjected message as AI-exempt.

## Requirements

### Requirement: Ham training tags the reinjected message

When the ham training workflow moves a message from the `train.ham` folder back to
`FOLDER_INBOX`, the system SHALL set the `$ScannerTrained` IMAP keyword flag on that
message before or as part of the move.

#### Scenario: Ham-trained message carries the flag on reinjection

- **WHEN** a message in `train.ham` is successfully learned as ham (or permanently
  fails to learn and is moved on unlearned, per the existing best-effort training
  behavior) and moved to `FOLDER_INBOX`
- **THEN** the message carries the `$ScannerTrained` flag once it lands in
  `FOLDER_INBOX`

### Requirement: Whitelist training tags the reinjected message

When the whitelist training workflow moves a message from the `train.whitelist`
folder back to `FOLDER_INBOX`, the system SHALL set the `$ScannerTrained` IMAP
keyword flag on that message before or as part of the move, regardless of whether a
sender address was successfully extracted from it.

#### Scenario: Whitelist-trained message carries the flag on reinjection

- **WHEN** a message in `train.whitelist` is processed (sender extracted and added to
  the whitelist, or no extractable sender found) and moved to `FOLDER_INBOX`
- **THEN** the message carries the `$ScannerTrained` flag once it lands in
  `FOLDER_INBOX`

### Requirement: Spam and blacklist training do not tag messages

The spam training workflow (`train.spam` → `FOLDER_SPAM`) and the blacklist training
workflow (`train.blacklist` → `FOLDER_SPAM`) SHALL NOT set the `$ScannerTrained` flag,
since neither reinjects the message into a folder the scan workflow processes.

#### Scenario: Spam-trained message is not tagged

- **WHEN** a message in `train.spam` is learned as spam and moved to `FOLDER_SPAM`
- **THEN** the message does NOT carry the `$ScannerTrained` flag

### Requirement: Scan workflow exempts flagged messages from AI classification

For each message in a scan batch that carries the `$ScannerTrained` flag, the scan
workflow SHALL exclude it from AI classification, the same way it excludes an
authenticated-whitelist match (per `sender-lists`) - the message is still scored by
rspamd as normal (including Bayes, so training still takes effect) and keeps
whichever tier its rspamd/whitelist-adjusted score alone produces.

#### Scenario: Flagged message in the clean tier is not sent to AI

- **WHEN** a `$ScannerTrained`-flagged message's rspamd score places it in the
  `clean` tier
- **THEN** the message is not submitted to AI classification and remains in the
  `nonSpamMessages` bucket

#### Scenario: Flagged message in the low tier is not sent to AI

- **WHEN** a `$ScannerTrained`-flagged message's rspamd score places it in the `low`
  tier
- **THEN** the message is not submitted to AI classification and remains in the
  `lowSpamMessages` bucket

#### Scenario: Flag exemption does not affect other messages from the same sender

- **WHEN** a later, different message arrives from the same sender as a previously
  `$ScannerTrained`-flagged message, without the flag itself set on the new message
- **THEN** the new message is submitted to AI classification normally, subject to the
  same rules as any other message (including any separate whitelist exemption its
  sender may independently qualify for)
