# Design

## Context

See `proposal.md` for motivation. Today rspamd runs one global Bayes corpus:
`rspamd/config/classifier-bayes.conf` contains only `backend = "redis";`, and
the server's `RspamdGateway` (`app/server/src/infrastructure/rspamd/rspamd.gateway.ts`)
sends no per-user selector on `/checkv2`, `/learnspam`, or `/learnham`. Every
mailbox therefore trains and is scored against the same model.

The mailbox id is already the natural per-user key: it is an email address
(`MAILBOX_ID` is `z.email()`), it is already established as "the rspamd user"
by `2-nest-server-foundation`, and it is available wherever rspamd is called -
`RspamdCheckStep.processOne` and `RspamdTrainingService.runSpam/runHam` both
receive a `MailboxSession` carrying `session.mailbox.id`.

**Verified against rspamd 3.14** (the pinned image in `docker-compose.base.yml`,
`rspamd/rspamd:3.14`; `rspamd/config` mounts at `/etc/rspamd/local.d`, so
`classifier-bayes.conf` is the classifier's `local.d` override):

- **Enabling per-user:** add `per_user = true;` to the classifier config
  (docs also call this `users_enabled = true`; `per_user` is the option name
  shown in the 3.14 classifier template). No other statfile/backend change is
  needed - the existing `backend = "redis"` and default `new_schema = true`
  stay.
- **Selecting the user over HTTP:** the `Deliver-To` request header sets the
  delivery recipient rspamd uses for per-user statistics (rspamd protocol
  doc: *"Deliver-To - Defines actual delivery recipient of message. Can be
  used for personalized statistics and for user specific options."*). This is
  the HTTP equivalent of `rspamc -d <user>`. It applies to `/checkv2`,
  `/learnspam`, and `/learnham` alike.
- **Redis key layout:** with `new_schema = true`, the key prefix pattern is
  `%s%l` when `per_user = false` and automatically `%s%l%r` when
  `per_user = true`, where `%s` expands to the literal `RS`, `%l` is the
  language label, and `%r` is the user. The user component is appended after
  the global portion, so **a per-user key is the corresponding global key with
  the mailbox id appended** - the transform the migration relies on.
- **No-user fallback:** with per-user enabled, rspamd *"also looks to the
  default ... user's statistics,"* so a request that sends no `Deliver-To`
  resolves against the default (shared) corpus rather than failing. This is
  what makes enabling per-user backward-compatible for any caller that sends
  no user (see D4).

## Goals / Non-Goals

**Goals:**
- Enable per-user Bayes in the shared rspamd config.
- Send `Deliver-To: <mailbox id>` on scoring and both training calls, so a
  mailbox's scoring and training act on the same per-user model.
- Provide a one-off, standalone migration that copies the global corpus to
  the first mailbox's per-user keys, preserving the global corpus.
- Keep the change safe to land regardless of whether `terminal/` is still
  running (D4).

**Non-Goals:**
- Changing where the corpus is stored (`rspamd-external-storage` is
  unchanged - still Redis under `${SPAM_SCANNER_DATA}/redis/`).
- Multi-recipient handling / LDA-stage delivery concerns - the server scores
  one mailbox at a time and sends exactly one `Deliver-To`, so rspamd's
  "first recipient wins" multi-recipient caveat does not apply.
- Per-user fuzzy storage, per-user settings, or per-user anything beyond
  Bayes.
- Teaching `terminal/` to send a user. D4 makes that unnecessary; terminal is
  being retired and its scoring stays on the default corpus until it is.
- Automating the migration into server startup - it is explicitly a one-off
  operator action.

## Decisions

### D1. Enable per-user in `classifier-bayes.conf`

Add `per_user = true;` to `rspamd/config/classifier-bayes.conf` (alongside the
existing `backend = "redis";`). This file is mounted read-through into
`/etc/rspamd/local.d/classifier-bayes.conf` and merged into the stock
classifier config, so no other rspamd file changes. A short comment records
why (per-mailbox models) and the exact-key consequence (prefix becomes
`%s%l%r`) for the next operator.

**Alternative considered:** a custom Lua `per_user` function reading a header.
Rejected: unnecessary - the built-in `per_user = true` with the standard
`Deliver-To` header already keys on exactly the value we send, with no Lua to
maintain.

### D2. `RspamdGateway` sends `Deliver-To` from an explicit user argument

Add an optional `user?: string` parameter to `checkEmail`, `learnHam`, and
`learnSpam`, and have `buildHeaders` set `headers['Deliver-To'] = user` when a
non-empty user is passed. The header is omitted entirely when no user is
given, so the gateway's existing callers/tests that pass no user keep hitting
the default corpus (D4) and every existing test stays valid.

`buildHeaders` currently takes only an envelope; extend it to also accept the
user (e.g. a second argument, or fold `user` into the options it reads).
`checkEmail` already forwards an envelope to `buildHeaders`; `learnHam`/
`learnSpam` call `buildHeaders()` with none and gain the user pass-through.

### D3. Thread `session.mailbox.id` through the two call sites

- **Scoring:** `RspamdCheckStep.processOne` already has `session`; change its
  `this.rspamd.checkEmail(raw, rspamdEnvelope)` call to
  `this.rspamd.checkEmail(raw, rspamdEnvelope, session.mailbox.id)`.
- **Training:** `RspamdTrainingService` currently binds two user-less
  `LearnFn` instance fields (`trainSpam`/`trainHam`). Because the user varies
  per session, replace those fields with per-run closures built inside
  `runSpam(session)`/`runHam(session)` that capture `session.mailbox.id`:
  `(raw) => this.rspamd.learnSpam(raw, session.mailbox.id)` (and `learnHam`).
  `trainMessages`/`LearnFn`'s signature is unchanged - the user is captured in
  the closure, not added to the `LearnFn` type - so `rspamd-training.step.ts`
  needs no change.

This keeps `MailboxSession`, `trainMessages`, and the step signatures
untouched; only the two service/step call sites and the gateway change.

### D4. Migration copies (does not move) the global corpus, which also settles the terminal-cutover question

The proposal flags a sequencing risk: enabling per-user while `terminal/`
still sends no user could change terminal's scoring. The verified no-user
fallback (Context) plus **copy, not move** semantics remove it:

- Enabling `per_user = true` does not change how a no-user request is served -
  it still resolves against the default corpus. Terminal (which sends no
  `Deliver-To`) therefore keeps training and scoring against that same default
  corpus, unchanged.
- The migration **copies** the global/default Bayes keys to the first
  mailbox's per-user keys (by appending the mailbox id, per the verified key
  layout) and **leaves the originals in place**. So after migration: the
  first mailbox has a seeded per-user model, every later mailbox starts empty,
  and the default corpus still exists for any no-user caller (terminal).

Consequently this change is safe to land independent of terminal cutover; it
does not need to wait for, or modify, `terminal/`.

### D5. The migration is a standalone, dry-run-first script outside the server app

Add a dependency-free POSIX shell script under the repo's shared operational
tooling (e.g. `bin/migrate-bayes-per-user.sh`, next to the other rspamd/redis
helpers like `bin/local/hash-rspamd-password.sh`), rather than a TypeScript
script inside `app/server`. This deliberately avoids adding a Redis client
npm dependency to the server just for a one-off tool that "can be deleted
afterwards": the script drives `redis-cli` (directly, or via
`docker compose exec redis redis-cli`) against the same Redis the stack
already runs. Behavior:

1. **Backup reminder / guard:** refuse to run destructive steps unless the
   operator confirms a Redis backup of `${SPAM_SCANNER_DATA}/redis/` exists
   (the proposal calls this out); at minimum print the backup instruction
   prominently.
2. **Discover** the global Bayes keys: scan Redis (`SCAN`, not `KEYS`) for the
   Bayes keyspace (prefix `RS...`), excluding keys that are already per-user
   (they end with a mailbox id / contain `@`). Because the exact key set is
   version-specific, the script prints the discovered keys for the operator to
   eyeball against `rspamc stat` before applying.
3. **Dry-run by default:** print each planned `global-key -> global-key+<id>`
   copy without executing. An explicit `--apply` flag performs the copies
   (Redis `COPY` per key, or `DUMP`+`RESTORE` for older servers), never
   deleting the source.
4. Take the first mailbox's id from the same env the server reads
   (`MAILBOX_ID`), so "the first mailbox" is unambiguous.

The script is intentionally conservative and operator-driven rather than
clever: it does not enable per-user itself (D1 does), does not restart rspamd,
and does not delete anything. Its correctness is verified by the operator
against the live instance, satisfying the proposal's "verify before
committing" requirement - the design records the verified mechanics (D-context)
but the one-off run is a human-checked operation.

**Alternative considered:** direct `RENAME` of the global keys onto the
per-user names. Rejected: it would move the default corpus out from under any
no-user caller (terminal), reintroducing exactly the sequencing risk D4
removes. Copy is strictly safer for a one-directional, re-runnable migration.

## Risks / Trade-offs

- **[Risk] The exact Redis key set for the global corpus is version-specific**
  and could include auxiliary keys (learn counters, `learned_ids` cache) that
  should or should not be copied. → Mitigation: dry-run + operator
  verification against `rspamc stat`/`redis-cli --scan` before `--apply`; copy
  (never move) so a wrong guess is non-destructive and re-runnable.
- **[Risk] `Deliver-To` is also consumed by other rspamd modules** (it is a
  general delivery-recipient header, not Bayes-only), so sending it could in
  principle influence user-specific settings. → Acceptable: the value is the
  mailbox's own address, which is the correct delivery recipient; no
  per-user settings are configured, so only Bayes is affected today.
- **[Trade-off] Copy leaves a now-stale global corpus in Redis** after
  migration. → Acceptable and intended: it is the fallback for any no-user
  caller during the terminal retirement window, and can be pruned later once
  nothing sends no-user requests.
- **[Risk] A mailbox id that is not the actual SMTP delivery recipient** (e.g.
  a provider that rewrites recipients) could theoretically key the model
  differently than expected. → Out of scope: the server already treats the
  mailbox id as the rspamd user throughout; this change is consistent with
  that established decision.
