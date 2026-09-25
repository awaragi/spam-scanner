# rspamd-per-user-bayes Specification

## Purpose
Governs how each mailbox trains and is scored against its own rspamd Bayes
model rather than one shared corpus: per-user Bayes enabled in the shared
rspamd config, the mailbox id sent as the rspamd user on every scoring and
training call, and a one-off migration of the existing global corpus to the
first mailbox.

## Requirements

### Requirement: Each mailbox trains and is scored against its own Bayes model
The server SHALL cause rspamd's Bayes classifier to train and score each
mailbox against a model keyed by that mailbox's id, so that one mailbox's
ham and spam training does not affect any other mailbox's Bayes scoring.

#### Scenario: One mailbox's training does not affect another's scoring
- **WHEN** one mailbox trains rspamd on a message as spam and a different
  mailbox is then scored against rspamd
- **THEN** the first mailbox's training does not contribute to the second
  mailbox's Bayes score, because each uses its own per-user model

### Requirement: The mailbox id is sent as the rspamd user on scoring
When the server scores a message for a mailbox, it SHALL send that mailbox's
id to rspamd as the per-user selector, so the score is computed against that
mailbox's own Bayes model. Scoring and training for a mailbox SHALL use the
same per-user selector so they act on the same model.

#### Scenario: A scoring request carries the mailbox as the rspamd user
- **WHEN** the server scores a message on behalf of a mailbox
- **THEN** the scoring request identifies that mailbox to rspamd as the
  per-user selector

### Requirement: The mailbox id is sent as the rspamd user on training
When the server trains rspamd on a message for a mailbox (as spam or as
ham), it SHALL send that mailbox's id to rspamd as the per-user selector, so
training updates that mailbox's own Bayes model and not the shared model.

#### Scenario: A spam-training request carries the mailbox as the rspamd user
- **WHEN** the server trains rspamd on a spam message for a mailbox
- **THEN** the training request identifies that mailbox to rspamd as the
  per-user selector

#### Scenario: A ham-training request carries the mailbox as the rspamd user
- **WHEN** the server trains rspamd on a ham message for a mailbox
- **THEN** the training request identifies that mailbox to rspamd as the
  per-user selector

### Requirement: Per-user Bayes is enabled in the shared rspamd configuration
The shared rspamd configuration SHALL enable per-user Bayes statistics so
that the per-user selector sent on scoring and training selects a per-mailbox
model. This configuration is shared by every deployment that uses this
rspamd instance.

#### Scenario: The classifier is configured for per-user statistics
- **WHEN** the rspamd Bayes classifier configuration is loaded
- **THEN** per-user Bayes statistics are enabled

### Requirement: A request that sends no user still resolves against a model
Enabling per-user Bayes SHALL NOT cause a scoring or training request that
sends no per-user selector to fail. Such a request SHALL resolve against
rspamd's default (shared) Bayes model, preserving the behavior of any caller
that does not send a user.

#### Scenario: A no-user request scores against the default model
- **WHEN** a scoring or training request is made without a per-user selector
  after per-user Bayes is enabled
- **THEN** the request is served against the default (shared) model rather
  than rejected

### Requirement: The existing global corpus is migrated to the first mailbox once
The change SHALL provide a one-off migration that copies the existing global
Bayes corpus to the first mailbox's per-user model, so that mailbox retains
its accumulated training history when per-user Bayes is enabled. The
migration SHALL preserve the original global corpus rather than destroying
it, so any caller still relying on the default model is unaffected. Mailboxes
other than the first SHALL start from an empty per-user model. The migration
SHALL be runnable independently of the server application and SHALL NOT run
automatically as part of normal server operation.

#### Scenario: The first mailbox keeps its history after migration
- **WHEN** the migration is run against a deployment that previously used a
  single global corpus
- **THEN** the first mailbox's per-user model contains the previously
  accumulated training, and the original global corpus still exists

#### Scenario: A later-added mailbox starts empty
- **WHEN** a mailbox other than the first is scored or trained after per-user
  Bayes is enabled
- **THEN** it uses its own initially-empty per-user model, not the migrated
  corpus
