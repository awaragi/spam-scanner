# Proposal

## Why

`IMAP_TLS` defaults to `true`, but an operator can disable it with a bare
`IMAP_TLS=false` - no extra friction, no warning, easy to set by accident (or copy
from an old snippet) without realizing it turns off transport encryption entirely.
Separately, when `IMAP_TLS=false`, `imap.client.js`'s `newClient()` passes
`secure: false` and leaves ImapFlow's `doSTARTTLS` at its default (`undefined`),
which per ImapFlow's own docs "may expose the connection to a downgrade attack" -
STARTTLS is attempted opportunistically but silently skipped if a
man-in-the-middle strips the server's STARTTLS advertisement, and the connection
continues in plaintext with no error.

## What Changes

- Add `IMAP_ALLOW_INSECURE` (default `false`) to the config schema. Setting
  `IMAP_TLS=false` without also setting `IMAP_ALLOW_INSECURE=true` fails load-time
  validation (same mechanism as the existing `AI_MODEL`/`AI_API_KEY`/threshold
  checks in `config-validation`), naming both fields in the error.
- When configuration loads with `IMAP_TLS=false` (and therefore
  `IMAP_ALLOW_INSECURE=true`, since that combination is otherwise rejected), log a
  `warn`-level message noting that IMAP transport encryption's direct-TLS wrapper is
  disabled.
- `imap.client.js`'s `newClient()` sets `doSTARTTLS: true` whenever
  `IMAP_TLS=false` (i.e. `secure: false`), so the connection attempt fails loudly if
  the server doesn't support STARTTLS instead of silently continuing in plaintext.
  **BREAKING** for the narrow case of a server with no STARTTLS support at all: such
  a server was reachable in plaintext before this change and will fail to connect
  after it. No other combination changes behavior (`IMAP_TLS=true` is unaffected;
  `doSTARTTLS` is left `undefined`, ImapFlow's default, whenever `secure: true`,
  since `secure: true` + `doSTARTTLS: true` is invalid per ImapFlow).

## Capabilities

### New Capabilities

- `imap-transport-security`: governs `IMAP_TLS`/`IMAP_ALLOW_INSECURE`'s combined
  gate and the resulting `doSTARTTLS` enforcement passed to the IMAP client.

### Modified Capabilities

- `config-validation`: the load-time validation requirement's list of what's
  checked gains the `IMAP_TLS`/`IMAP_ALLOW_INSECURE` combination.

## Impact

- `src/lib/core/config.js` - new `IMAP_ALLOW_INSECURE` field, new `superRefine`
  check, new warning log.
- `src/lib/clients/imap.client.js` - `newClient()`'s `doSTARTTLS` option.
- `.env.example` / `README.md` - document the new variable (per `CLAUDE.md`'s
  "document new environment variables in `.env.example` alongside `README.md`"
  convention).
