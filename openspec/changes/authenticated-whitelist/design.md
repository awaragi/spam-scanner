# Design

## Context

See proposal.md - Why. Relevant current-code details gathered while scoping this change:

- `parseRspamdOutput` (`src/lib/utils/email-parser.util.js`) currently discards rspamd's
  `symbols` field entirely - a deliberate prior decision (see its docstring) to keep rspamd
  "a stateless content scorer only" with no list/mailbox awareness feeding back into app
  logic. Reading `symbols` for an authentication fact doesn't reintroduce list/mailbox
  awareness into rspamd (rspamd still knows nothing about whitelists) - it only reads a
  content-scoring signal rspamd already computes for every message regardless of any list.
- Verified against the pinned `rspamd/rspamd:3.14` image's
  `/usr/share/rspamd/config/scores.d/policies_group.conf`, the real symbol names are:
  `R_DKIM_ALLOW` (not `DKIM_ALLOW`), `DMARC_POLICY_ALLOW`,
  `DMARC_POLICY_ALLOW_WITH_FAILURES`, and SPF's `R_SPF_ALLOW`.
- `R_SPF_ALLOW` requires envelope MAIL FROM/IP data, which the app does not send today
  (ROADMAP.md 4.10, still open) - so SPF is excluded from the authentication signal for
  this change. DKIM verification needs no envelope data (it validates the message's own
  `DKIM-Signature` header against DNS). DMARC evaluates alignment against DKIM and/or SPF
  for the domain in the header `From`; with SPF unavailable, `DMARC_POLICY_ALLOW` here
  effectively means "DKIM-aligned DMARC pass." This means the signal is meaningfully
  available now, without waiting on 4.10 - though 4.10 landing later would make DMARC
  alignment stronger by adding SPF into the mix.
- `applyWhitelistAdjustments` (`src/lib/services/spam-classifier.service.js`) currently
  stamps `isWhitelisted` and `score - 20` unconditionally from a single `whitelistSet` set
  membership check via `senderAddressOf`.
- `partitionByWhitelistFlag` / `mergeWhitelistedBack` (same file) are pure functions the
  scan controller (`src/lib/controllers/workflows/scan.controller.js`) uses to hold
  whitelisted `clean`/`low` messages back from AI classification and merge them back in
  afterward, unconditionally on `isWhitelisted`.

## Goals / Non-Goals

**Goals:**

- Gate the whitelist's score discount and AI-skip on an authentication signal already
  available in rspamd's existing `/checkv2` response, with zero new I/O, config, or
  external dependency.
- Keep the change to a small, well-isolated set of pure functions plus one controller-level
  wiring change (the partition call), consistent with the project's
  services/utils/clients/controllers layering.

**Non-Goals:**

- Not touching blacklist behavior, extraction source preference (`From` vs `Reply-To`), or
  domain-entry support (ROADMAP.md 7.1.3/7.1.4) - out of scope for this change.
- Not adding SPF/envelope-IP passing (ROADMAP.md 4.10) - a separate, already-tracked
  finding this change deliberately doesn't depend on.
- Not making the −20/−5 values or the authenticating-symbol set configurable via env vars.
  Configurability is exactly the kind of thing ROADMAP.md 5.10 (config schema) is meant to
  generalize; adding one-off env vars here ahead of that would duplicate work. If the fixed
  values prove wrong in practice, that's a follow-up, not part of this change.

## Decisions

**Which symbols count as authenticated: `R_DKIM_ALLOW` OR `DMARC_POLICY_ALLOW`.**
Either one alone is a reasonable authentication signal (DKIM does not require DMARC to be
configured on the sending domain; DMARC's own alignment check is a stronger, domain-level
guarantee). Using OR (not AND) avoids penalizing legitimate senders who have only one of
the two configured, which is still common. `DMARC_POLICY_ALLOW_WITH_FAILURES` is
deliberately excluded - per its own rspamd description it means the policy allowed the
message *despite* a DKIM/SPF failure, so it doesn't establish that the visible sender
actually sent it, which is exactly the property this change needs.
_Alternative considered_: requiring DMARC alignment specifically (not DKIM alone), since
DMARC ties the passing check to the header `From` domain while a bare DKIM pass only proves
*a* valid signature exists (possibly from an unrelated domain, e.g. a marketing platform
signing on behalf of a spoofed-looking `From`). Rejected for this change: rspamd's DKIM
check already validates the signature's `d=` domain is consistent with what it evaluates,
and requiring DMARC-only would exclude many small/self-hosted senders who publish DKIM but
never set up a DMARC record - too strict for a first cut. Worth revisiting if false
positives on the "authenticated" side show up in practice.

**Reduced adjustment for unauthenticated match: −5, not −20 or 0.**
The roadmap finding left this as "a smaller adjustment (or none)". Zero was considered and
rejected: it would make an unauthenticated whitelist entry behave identically to no entry
at all, silently discarding information the user deliberately provided (they whitelisted
this address for a reason, even if the current message can't be proven to be from it). −5
still meaningfully helps a message from a sender whose infrastructure genuinely doesn't
sign outbound mail (common on small/self-hosted setups) without being large enough to mask
a spoofed phishing message's score the way −20 could. This is a judgment call with no
formula behind it - flagged here rather than in Open Questions because it doesn't block
implementation and is easy to tune later (a constant in one function) if real-world mail
shows it's off.

**Two-flag design (`isWhitelisted` + `isSenderAuthenticated`) rather than collapsing into
one.** `spamInfo.isWhitelisted` keeps meaning exactly what it means today (address
matched); a new `spamInfo.isSenderAuthenticated` is orthogonal (rspamd found a passing
DKIM/DMARC symbol, independent of whether the sender is even whitelisted). Keeping them
separate lets `applyWhitelistAdjustment` decide the discount amount from both flags without
conflating "matched" and "trusted," and keeps `isSenderAuthenticated` available for
potential future use (e.g. blacklist extraction preferring an authenticated domain, per the
out-of-scope 7.1.4) without another plumbing change.

**Where `isSenderAuthenticated` is computed: `parseRspamdOutput`, not a new function.**
It already parses rspamd's raw response into the shape `rspamd-check.step.js` consumes; the
`symbols` lookup is a few lines alongside the `score`/`required` extraction already there,
and avoids introducing a second raw-response-reading code path. Its docstring's now-outdated
"symbols are no longer used" claim gets updated in the same change.

## Risks / Trade-offs

**[Risk] Small self-hosted senders who don't sign outbound mail get less benefit than
today.** A whitelisted contact on a mail server with no DKIM/DMARC configured now gets −5
instead of −20 for every message, potentially pushing borderline-scored ham into `low` or
even `high` where it wouldn't have been before. → Mitigation: −5 (not 0) keeps a real
discount for this case; if false positives appear in practice for specific
correspondents, the user's existing options (train more ham, or add a rspamd-side
per-domain adjustment) still apply, and this is a smaller regression than the phishing
gap the change closes.

**[Risk] DKIM/DMARC evaluation itself can be wrong or unavailable** (DNS failures,
misconfigured sending domain, rspamd's DNS resolution issues - separately being improved by
the unrelated `5.6` unbound-wiring fix). A transient DNS hiccup could cause a normally
authenticated sender's single message to fall back to the −5 tier. → Mitigation: this is
symmetric with how rspamd already treats DKIM/DMARC failures for scoring everyone else
(not new fragility introduced by this change) and self-corrects on the next successfully
resolved message.

## Migration Plan

No data migration - this only changes how already-flowing rspamd response data and
already-stored whitelist state are combined at scan time. No state schema change, no env
var, no backfill. Deploys as an ordinary code change; the very next scan cycle after
deploy uses the new logic. No rollback concerns beyond reverting the commit.
