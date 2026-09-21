# Design

## Context

See `proposal.md` - Why. Relevant current state, read directly from source:

- `config.js`'s `boolField(defaultValue)` helper already handles the
  "default-true, explicit-false opts out" (`IMAP_TLS`) vs. "default-false,
  explicit-true opts in" (`AI_ENABLED`) shapes - `IMAP_ALLOW_INSECURE` is the second
  shape (`boolField(false)`).
- The existing `superRefine` block on `ConfigSchema` is exactly where
  `AI_MODEL`/`AI_API_KEY`/threshold cross-field checks already live - the new
  `IMAP_TLS`/`IMAP_ALLOW_INSECURE` check is one more entry there, following the
  same `ctx.addIssue` shape.
- ImapFlow's own JSDoc (`node_modules/imapflow/lib/imap-flow.js`) states
  `secure: true` combined with `doSTARTTLS: true` is invalid, and that
  `doSTARTTLS: undefined` (the current, unset default) "may expose the connection
  to a downgrade attack" when `secure: false`.

## Goals / Non-Goals

**Goals:**

- No accidental plaintext IMAP: disabling direct TLS requires a second, explicitly-named
  opt-in.
- No silent downgrade: once insecure mode is opted into, STARTTLS is required, not
  merely attempted.

**Non-Goals:**

- Not adding a third tier for "fully plaintext, no STARTTLS at all" servers. See
  Risks - this is a deliberate, narrow compatibility trade-off for an XS-complexity
  finding, not a gap to silently work around.
- Not changing `IMAP_TLS`'s own default or behavior when `true` (the overwhelming
  majority case).

## Decisions

**`IMAP_ALLOW_INSECURE` is a second config field, not a single combined enum (e.g.
`IMAP_TLS=insecure`).** Keeps `IMAP_TLS` boolean-shaped (matches its existing
name/type/every other on-off config field in the schema) and makes the opt-in
self-documenting by name (`ALLOW_INSECURE` reads as a warning on its own, in
`.env` files, logs, and error messages) rather than requiring a reader to already
know what a third enum value means.

**The gate lives in `config.js`'s existing `superRefine`, not a new standalone
check.** Matches `config-validation`'s established pattern (single declarative
schema, all cross-field checks in one place) rather than introducing a second
validation mechanism for one field pair.

**`doSTARTTLS: true` whenever `secure: false`, with no way to opt out of STARTTLS
enforcement short of re-enabling `IMAP_TLS`.** This is the one deliberately
BREAKING edge case (see proposal.md): a genuinely STARTTLS-incapable legacy server
was reachable in plaintext before this change and will fail to connect after it.
Alternative considered: a third variable (e.g. `IMAP_REQUIRE_STARTTLS`, default
`true`, settable to `false` to restore today's opportunistic behavior) - rejected
as over-engineering an XS-complexity finding for a server population (IMAP with no
STARTTLS support in 2026) the project has no evidence any actual user runs against;
easy to add later as a follow-up if a real user hits it.

## Risks / Trade-offs

- [A real operator has a STARTTLS-incapable IMAP server and this change breaks
  their setup] → Would previously have connected in plaintext with no warning at
  all - arguably that setup was already worth surfacing loudly rather than
  supporting silently. If this turns out to affect a real user, the fix is a
  follow-up variable (see Decisions), not a reason to hold this change.
- [Existing deployments with `IMAP_TLS=false` and no `IMAP_ALLOW_INSECURE` set will
  fail to start after upgrading] → Intentional per the proposal's explicit-gate
  goal; the failure is a clear, load-time configuration error naming exactly which
  variable to set, not a runtime crash mid-cycle.

## Migration Plan

No data migration. Any deployment already running with `IMAP_TLS=false` needs
`IMAP_ALLOW_INSECURE=true` added to its `.env` on upgrade, or it fails fast at
startup with a clear error naming the missing variable - documented in
`.env.example`/`README.md` as part of this change. Rollback is a plain revert.
