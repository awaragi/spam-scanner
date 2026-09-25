# Proposal

## Why

rspamd's Bayes classifier currently keeps one global corpus
(`rspamd/config/classifier-bayes.conf` only sets `backend = "redis"`), so every
mailbox trains and is scored against the same model. With several mailboxes
on one server, that mixes one person's ham with another person's spam. Each
mailbox should train and be scored against its own model, keyed by its
internal id (its email address).

Depends on `2-nest-server-foundation` (mailbox id = rspamd user).

## What Changes

- **Per-user Bayes in rspamd.** Enable it in
  `rspamd/config/classifier-bayes.conf` (`per_user` or its equivalent in the
  deployed rspamd version).
- **Send the user on every call.** The server's rspamd gateway sends the
  mailbox id as the rspamd user (the `Deliver-To` header, or whatever the
  deployed version expects) on `/checkv2` **and** on `/learnspam` and
  `/learnham`. Scoring and training must use the same model.
- **One-off migration script.** It copies the existing global Bayes corpus in
  Redis under the first mailbox's per-user keys, so that mailbox keeps its
  training history. The script lives outside the server app, runs once, and
  can be deleted afterwards. Mailboxes added later start from an empty model.
- **Verify before committing.** Before relying on this, verify against rspamd's
  docs and version how per-user Redis keys are named, and whether a request
  without a user falls back to the global corpus.

## Capabilities

### New Capabilities

- `rspamd-per-user-bayes`: per-user Bayes enabled in the shared rspamd config,
  the mailbox id sent as the rspamd user on check and learn, and the one-off
  global-to-first-mailbox corpus migration.

### Modified Capabilities

_None._ `rspamd-external-storage` (where the corpus lives) is unchanged.

## Impact

- **Shared infrastructure.** rspamd and Redis are shared by the production and
  local-dev stacks (`rspamd-external-storage`), and by `terminal/` if it is
  still running. Turning on per-user Bayes while terminal still sends no user
  could change terminal's scoring. So this change should land at or after
  cutover, or terminal must first be taught to send the same user (design
  decides).
- **Redis.** The migration touches the live Bayes corpus. Take a backup of
  `${SPAM_SCANNER_DATA}/redis/` before running it.
