# Proposal

## Why

Whitelist/blacklist matching runs in app code against the message's envelope `From`
address with no authentication requirement (ROADMAP.md 4.1). A whitelist hit today gets an
unconditional **−20** score adjustment and skips the AI safety net. Phishing that forges
the `From:` of a whitelisted contact (bank, employer, family member) — the most common
phishing pattern — still lands with a discounted score and no AI check. Verified against
the pinned `rspamd/rspamd:3.14` image's `scores.d/policies_group.conf`: rspamd already
computes `R_DKIM_ALLOW` and `DMARC_POLICY_ALLOW`/`DMARC_POLICY_ALLOW_WITH_FAILURES` symbols
from the message's own headers (DKIM needs no envelope data; DMARC can align on DKIM alone
when SPF is unavailable, which it is today per the still-open 4.10 finding) — so this
authentication signal is available now, without waiting on 4.10.

## What Changes

- `checkEmail`'s rspamd `/checkv2` response `symbols` field is no longer discarded
  entirely: the app now extracts whether the response contains an authenticating symbol
  (`R_DKIM_ALLOW`, or `DMARC_POLICY_ALLOW`) and threads that boolean through as
  `spamInfo.isSenderAuthenticated`. `DMARC_POLICY_ALLOW_WITH_FAILURES` does NOT count —
  its own description says the policy allowed the message despite a DKIM/SPF failure, so
  it is not a reliable proof the visible `From:` sender actually sent it.
- A whitelist hit's score adjustment is now conditional on that authentication signal:
  - Authenticated hit (sender's domain has a passing DKIM or DMARC alignment): full **−20**
    adjustment, same as today.
  - Unauthenticated hit (whitelisted address matched, but rspamd found no passing DKIM/DMARC
    symbol for the message): a reduced **−5** adjustment — enough that a genuinely clean
    message from a whitelisted contact whose mail server doesn't sign outbound mail (still
    common on small/self-hosted setups) isn't penalized relative to an unlisted sender, but
    not enough to mask a spammy/phishing score the way −20 could.
- The AI-classification skip that whitelisted messages currently get is now conditional on
  the same authentication signal: an authenticated whitelist hit still skips AI (unchanged
  behavior); an unauthenticated whitelist hit is treated like a non-whitelisted message and
  goes through AI classification normally.
- Blacklist behavior is **unchanged** — it remains an unconditional override regardless of
  authentication. (Extracting blacklist addresses preferentially from an authenticated
  `From`/`Return-Path` domain, and excluding `Reply-To`, is ROADMAP.md 7.1.4, out of scope
  here.)

## Capabilities

### Modified Capabilities

- `sender-lists`: the "Whitelist membership adjusts rspamd's score" requirement gains an
  authentication precondition for the full −20 adjustment plus a reduced −5 adjustment for
  an unauthenticated match.
- `scan-inbox`: the existing "A whitelisted sender's `clean`- or `low`-tier message SHALL
  also be excluded from AI classification" requirement (`spec.md` line 99) becomes
  conditional on the same authentication signal — only an *authenticated* whitelist match
  skips AI; an unauthenticated match is submitted to AI like any other `clean`/`low`
  message.

## Impact

- `src/lib/utils/email-parser.util.js` (`parseRspamdOutput`): starts reading rspamd's
  `symbols` field for two known symbol names instead of ignoring it; its docstring's
  "symbols are no longer used" claim is now outdated and needs updating.
- `src/lib/controllers/steps/rspamd-check.step.js`: attaches `isSenderAuthenticated` to
  `spamInfo`.
- `src/lib/services/spam-classifier.service.js` (`applyWhitelistAdjustment`,
  `applyWhitelistAdjustments`): the −20 constant becomes two constants, gated on
  `isSenderAuthenticated`; `partitionByWhitelistFlag` (used by
  `src/lib/controllers/workflows/scan.controller.js` to hold whitelisted messages back
  from AI) partitions on `isWhitelisted && isSenderAuthenticated` instead of `isWhitelisted`
  alone.
- `openspec/specs/sender-lists/spec.md` and `openspec/specs/scan-inbox/spec.md`.
- Test fixtures for a rspamd `/checkv2` response need a `symbols` object in both the
  authenticated and unauthenticated shapes.
- No config schema, env var, or Docker/compose changes.
