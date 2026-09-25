# Proposal

## Why

Once one server serves several mailboxes, one global `.env` can no longer
describe how each mailbox should be handled (folder names, thresholds,
processing mode). The project already keeps per-mailbox state inside the
mailbox itself, as JSON messages in its state folder, so settings can live
there too. A mailbox record then needs nothing more than connection info and
the state folder.

Depends on `3-mailbox-runners`. The API that writes settings comes in
`5-server-api-auth`.

## What Changes

- **A settings email per mailbox.** It sits in the mailbox's state folder,
  under its own state key, in the same format as the existing state and list
  messages. It uses the same append-then-delete write and highest-UID-wins
  read.
- **Defaults from code only.** Every per-mailbox setting has a default defined
  in code. There is no env layer: `.env` holds app settings only, never
  per-mailbox defaults. The settings email holds only overrides, so a missing
  or empty settings email means the mailbox runs entirely on code defaults.
  The settings email is **not** created automatically.
- **Per-mailbox overridable keys:**
  - inbox, spam, spam-low, spam-high and training folder names;
  - `SCAN_READ`, `SCAN_INITIAL_STATE`;
  - processing mode (label or folder) and the label names;
  - the clean, low and confirmed thresholds;
  - the AI escalation thresholds;
  - an AI opt-out, which can switch AI off for a mailbox but never on when it
    is globally off.
- **Global only, never overridable:** everything else, including the interval,
  batch sizes, retries, rspamd, and all AI provider settings (enabled flag,
  key, model, concurrency, limits). Overrides are validated with zod, and an
  unknown or global-only key in the settings email is ignored with a warning.
- **The rspamd user is never a setting.** It is always the mailbox id.
- **Read once and cached.** Settings are loaded on the mailbox's first
  successful connection and cached for the life of the runner. They are not
  reloaded on every run. Until settings are loaded (the connection keeps
  failing), no jobs run and the mailbox stays `degraded`.
- **Changes only through the server.** The runner exposes an update
  operation. It validates the settings, stops the runner (the in-flight job
  finishes and the IDLE watcher closes), writes the settings email, refreshes
  the cache, and starts the runner again. Hand edits to the settings email are
  not supported, and the next update overwrites them.

## Capabilities

### New Capabilities

- `server/mailbox-settings`: the settings-email storage, the overridable key
  set and its validation, defaults-then-override resolution, the read-once
  cache, and update-by-restart with its overwrite semantics.

### Modified Capabilities

_None._ `state-manager`'s write and read guarantees apply to the new key as
they stand.

## Impact

- **Moves out of env:** the per-mailbox keys leave the server's env and
  schema. Scan and train code gets its settings from the mailbox's resolved
  settings, not from global config.

- **No carry-over from the old env.** Per-mailbox values in the existing
  `terminal` `.env` are not migrated into a settings email. The current
  mailbox already runs on the defaults, so it starts with no settings email.
