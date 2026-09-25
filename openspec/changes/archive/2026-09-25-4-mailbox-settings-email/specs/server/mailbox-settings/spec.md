# Spec Delta

## Purpose

Governs how each mailbox's behavioral settings (folders, thresholds,
processing mode, AI opt-out) are stored as overrides in that mailbox's own
state folder, resolved against code defaults, and updated safely while the
mailbox's runner is live.

## ADDED Requirements

### Requirement: Every per-mailbox setting has a code default, with no env layer
Every overridable per-mailbox setting SHALL have a default value defined in
code. The server SHALL NOT read any per-mailbox setting from an environment
variable. A mailbox with no stored settings override SHALL run entirely on
these code defaults.

#### Scenario: A mailbox with no settings email uses defaults
- **WHEN** a mailbox's state folder contains no settings message
- **THEN** that mailbox's resolved settings equal the code defaults exactly,
  with no per-mailbox environment variable consulted

### Requirement: Settings overrides are stored as a message in the mailbox's own state folder
A mailbox's settings overrides SHALL be stored as a single message in that
mailbox's state folder, under its own state key, using the same
append-then-delete write and highest-UID-wins read guarantees the existing
scanner state and list state use. The settings message SHALL NOT be created
automatically; its absence is a valid, permanent state, not an error.

#### Scenario: No settings message exists and none is created
- **WHEN** a mailbox has never had its settings updated through the server
- **THEN** its state folder contains no settings message, and the mailbox
  continues to run on code defaults indefinitely until an update is made

#### Scenario: A write is interrupted between append and delete
- **WHEN** a settings update's append succeeds but the process stops before
  the previous settings message is deleted
- **THEN** the next read selects the highest-UID settings message, exactly as
  scanner state and list state already do

### Requirement: Only a fixed set of keys are overridable per mailbox
Only the following settings SHALL be overridable per mailbox: the inbox,
spam, spam-low, spam-high, and training folder names; whether scanning
includes already-read messages; what an unscanned mailbox scans first;
the processing mode (label or folder) and its label names; the clean, low,
and confirmed score thresholds; the AI escalation thresholds; and a
per-mailbox AI opt-out. Every other setting - including the scan interval,
batch sizes, retry limits, rspamd connection settings, and every AI provider
setting (enabled flag, key, model, concurrency, and token limits) - SHALL
remain global-only and SHALL NOT be settable through a mailbox's settings
message.

#### Scenario: A settings message overrides only allowed keys
- **WHEN** a mailbox's settings message sets a folder name, a threshold, and
  the AI opt-out
- **THEN** the mailbox's resolved settings reflect all three overrides, each
  merged individually over its own code default, with every other setting
  still at its code default

### Requirement: A global-only or unrecognized key in a settings message is ignored with a warning
When a mailbox's settings message contains a key that is not one of the
overridable per-mailbox settings - whether it names a global-only setting or
is not a recognized setting at all - the server SHALL ignore that key when
resolving the mailbox's settings, SHALL log a warning identifying the
ignored key, and SHALL NOT let that key's presence prevent every other,
valid override in the same message from applying.

#### Scenario: A settings message includes a global-only key
- **WHEN** a mailbox's settings message includes a key that names a
  global-only setting (for example, the scan interval) alongside a valid
  per-mailbox override
- **THEN** the global-only key is ignored and a warning is logged, while the
  valid override still applies to that mailbox's resolved settings

### Requirement: The AI opt-out can only turn AI off, never on when it is globally disabled
A mailbox's AI opt-out override SHALL be able to disable AI classification
for that mailbox even when AI is globally enabled. It SHALL NOT be able to
enable AI classification for a mailbox when AI is globally disabled.

#### Scenario: A mailbox opts out while AI is globally enabled
- **WHEN** AI is globally enabled and a mailbox's settings message sets its
  AI opt-out to disable AI
- **THEN** that mailbox's classification never calls the AI provider, while
  other mailboxes without the opt-out still do

#### Scenario: A mailbox opts in while AI is globally disabled
- **WHEN** AI is globally disabled and a mailbox's settings message sets its
  AI opt-out to enable AI
- **THEN** that mailbox's classification still never calls the AI provider

### Requirement: The rspamd user is never a per-mailbox setting
A mailbox's settings message SHALL NOT be able to set or influence its
rspamd user. The rspamd user SHALL always be the mailbox's own id, exactly
as already established, regardless of anything present in that mailbox's
settings message.

#### Scenario: A settings message attempts to set an rspamd-related key
- **WHEN** a mailbox's settings message contains a key that does not
  correspond to any recognized per-mailbox setting, attempting to influence
  rspamd behavior
- **THEN** the key is ignored with a warning per the unrecognized-key
  requirement above, and the mailbox's rspamd user remains its id

### Requirement: Settings are read once, on first successful connection, and cached
A mailbox's settings SHALL be read from its state folder once, on that
mailbox's first successful connection, and cached for the life of that
mailbox's runner. Settings SHALL NOT be re-read on every job run. Until a
mailbox's settings have been successfully loaded, no job SHALL run for that
mailbox, and the mailbox SHALL be reported as degraded; the server SHALL
keep retrying with the same capped exponential backoff used for a failing
job, and SHALL NOT give up permanently or exit the process.

#### Scenario: Settings load once at bootstrap, not on every job
- **WHEN** a mailbox runs several scan and training jobs after its runner
  starts
- **THEN** its settings are read from the state folder only once, during
  bootstrap, and every job during that runner's lifetime uses the same
  cached settings

#### Scenario: The connection keeps failing before settings can be loaded
- **WHEN** a mailbox's connection fails repeatedly, before its settings have
  ever been successfully loaded
- **THEN** no job runs for that mailbox, the mailbox is reported as
  degraded, and the server keeps retrying the connection with capped
  exponential backoff rather than giving up or exiting

### Requirement: Settings can only be changed through the server, which validates, writes, and restarts
The server SHALL expose an operation to update a mailbox's settings
overrides. This operation SHALL validate the proposed overrides against the
same overridable-key rules used when reading settings, stop that mailbox's
runner (allowing its in-flight job to finish and its IDLE connection to
close, exactly as an ordinary shutdown does), write the new settings message
to the mailbox's state folder, and start a new runner for that mailbox that
reads and caches the freshly written settings. A hand edit made directly to
the settings message outside this operation is not supported: the next
update through the server overwrites it without preserving any of its
content.

#### Scenario: An update validates, applies, and takes effect on the new runner
- **WHEN** a valid settings update is submitted for a mailbox whose runner is
  currently running
- **THEN** the update is validated, the running runner is stopped without
  aborting its in-flight job, the new settings message is written, and the
  mailbox's new runner starts using the newly written settings - never the
  stale cached settings from before the update

#### Scenario: An invalid update is rejected without affecting the running mailbox
- **WHEN** a settings update contains a value that fails validation (for
  example, a threshold of the wrong type)
- **THEN** the update is rejected, no settings message is written, and the
  mailbox's currently running runner and its cached settings are left
  unaffected

#### Scenario: A hand-edited settings message is overwritten by the next update
- **WHEN** a settings message was edited directly in the mailbox rather than
  through the server's update operation, and a further update is then
  submitted through the server
- **THEN** the server's update writes a complete new settings message that
  replaces the hand-edited one entirely, without merging or preserving any
  of its content
