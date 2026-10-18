# Spec Delta

## MODIFIED Requirements

### Requirement: Only a fixed set of keys are overridable per mailbox
Only the following settings SHALL be overridable per mailbox through the
mailbox's IMAP settings message and mailbox-scoped settings API: the inbox,
spam, spam-low, spam-high, and training folder names; whether scanning
includes already-read messages; what an unscanned mailbox scans first;
the processing mode (label or folder) and its label names; the clean, low,
and confirmed score thresholds; and the AI escalation thresholds. Per-mailbox
AI enablement (`aiEnabled`) SHALL NOT be overridable through the settings
message or mailbox-scoped settings API; it SHALL be stored on the account
record and editable only by admins through the account API. Every other
setting - including the scan interval, batch sizes, retry limits, rspamd
connection settings, and every AI provider setting (enabled flag, key, model,
concurrency, and token limits) - SHALL remain global-only and SHALL NOT be
settable through a mailbox's settings message.

#### Scenario: A settings message overrides only allowed keys
- **WHEN** a mailbox's settings message sets a folder name and a threshold
- **THEN** the mailbox's resolved settings reflect both overrides, each
  merged individually over its own code default, with every other overridable
  setting still at its code default

#### Scenario: aiEnabled in a settings message is ignored
- **WHEN** a mailbox's settings message sets `aiEnabled`
- **THEN** the server logs a warning, ignores that key, and resolves
  `aiEnabled` from the account store instead

### Requirement: The AI opt-out can only turn AI off, never on when it is globally disabled
Per-mailbox AI classification for a mailbox SHALL be enabled only when AI
is globally enabled and that mailbox's account record has `aiEnabled` true.
A mailbox SHALL NOT use AI when its account record has `aiEnabled` false,
even if AI is globally enabled. A mailbox SHALL NOT use AI when AI is
globally disabled, even if its account record has `aiEnabled` true.

#### Scenario: A mailbox opts out while AI is globally enabled
- **WHEN** AI is globally enabled and a mailbox's account has `aiEnabled`
  false
- **THEN** that mailbox's classification never calls the AI provider, while
  other mailboxes with `aiEnabled` true still do

#### Scenario: A mailbox opts in while AI is globally disabled
- **WHEN** AI is globally disabled and a mailbox's account has `aiEnabled`
  true
- **THEN** that mailbox's classification still never calls the AI provider
