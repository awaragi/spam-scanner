# Proposal

## Why

Whitelist/blacklist enforcement is currently split across two systems that can't be tested or reasoned about together: `rspamd/config/multimap.conf` matches the message's `From` address against local map files and applies a blunt `-20`/`+20` score nudge inside rspamd itself, while the app only ever observes the _result_ (`WHITELIST_EMAIL` symbol; blacklist isn't observed at all — it's inferred from `action === 'reject'`, which silently loses if a sender is ever listed on both maps, since `+20`/`-20` cancel to net zero with nothing to catch it). The local map files have no real source of truth either: `state-manager.js` already backs up their content to the IMAP state folder after every training run (`writeMapState`), but nothing ever reads that backup back.

This also blocks a real goal: running one shared rspamd instance across multiple IMAP mailboxes, each with its own trained whitelist/blacklist. A local map file rspamd reads is necessarily global to every mailbox that shares it — there is no way to keep it stateless and per-mailbox at the same time. rspamd needs to become purely a content scorer with zero list/mailbox awareness; list membership needs to move entirely into the app, keyed per mailbox via IMAP.

## What Changes

- **rspamd becomes fully stateless.** `multimap.conf`'s `whitelisted_email`/`blacklisted_email` rules are deleted entirely — rspamd scores message content only, with no map-file reads, no mailbox awareness, safe to share across multiple IMAP-mailbox scanner instances.
- **Blacklist** becomes an app-side, unconditional override: looked up by sender address (`envelope.from`) against a per-mailbox, IMAP-backed set, checked before rspamd is even called. A match routes straight to the `confirmed` tier and skips AI, regardless of content. No score math, no rspamd involvement.
- **Whitelist** becomes an app-side score adjustment: `-20` applied to rspamd's raw score for a matching sender, computed _after_ rspamd's content-only response comes back. The adjusted score still runs through normal categorization, so severe-enough content can still land a whitelisted sender in `confirmed` — preserving today's "rspamd can still override whitelist" safety net, just decided with the app's own threshold instead of a rspamd-internal one we don't have visibility into (see below).
- **Categorization becomes a 4-tier, fully app-owned threshold system**, replacing the current reliance on rspamd's own hidden `reject` cutoff (confirmed via `test/email-parser.test.js` fixtures that `required_score` is rspamd's _add-header_ threshold, not its reject threshold — the app has never actually had visibility into the real reject cutoff):
  - `clean` (nonSpam): score ≤ `SPAM_CLEAN_THRESHOLD`% of required (default `30`)
  - `low`: `SPAM_CLEAN_THRESHOLD`–`SPAM_LOW_THRESHOLD`% (default `60`)
  - `high`: `SPAM_LOW_THRESHOLD`–`SPAM_HIGH_THRESHOLD`% (default `100`) — labeled/foldered, stays in inbox
  - `confirmed`: ≥ `SPAM_CONFIRMED_THRESHOLD`% (default `200`), **or** an unconditional blacklist match — moved to `FOLDER_SPAM` outright, never reaches AI
  - All four thresholds move from hardcoded function-parameter defaults (currently unused — `scan-workflow.js` calls `categorizeMessages` with no overrides) to real `config.js` env vars, following the existing `AI_ESCALATE_TO_*_THRESHOLD` naming pattern.
- **The mailbox's IMAP state folder becomes the real source of truth** for list membership (read _and_ write) — the same pattern `state-manager.js` already uses for scanner state, not a local file with a write-only IMAP backup nobody restores from.
- `map-workflow.js` (`runWhitelist`/`runBlacklist`, driven by the `train.whitelist`/`train.blacklist` IMAP folders) writes extracted senders to the new IMAP-backed, per-mailbox list store instead of a local rspamd map file.
- AI escalation (`applyAiEscalation`) is unchanged in shape: it still only ever sees `nonSpam`/`lowSpam` messages and can never escalate into `confirmed`. Blacklisted and confirmed-tier whitelisted mail bypass it exactly the way rspamd-rejected mail does today; non-confirmed whitelisted mail continues to skip it entirely, same guarantee as today's `WHITELIST_EMAIL` short-circuit.
- **BREAKING**: `docker-compose.yml` (root and `bin/local/`) drop the `rspamd/maps` bind mount and `RSPAMD_WHITELIST_MAP_PATH`/`RSPAMD_BLACKLIST_MAP_PATH` env vars entirely, on **both** the `spam-scanner` and `rspamd` services — neither container touches list data on disk anymore.
- **Spoofing**, resolved: the `From` address used for matching is attacker-controlled and unauthenticated either way — not a new exposure, the current multimap rule has the same one. The blacklist/whitelist asymmetry above is deliberate: blacklist absolute-override is low risk (a spoofed blacklisted address only over-blocks a look-alike sender), so it needs no content check. Whitelist absolute-override would be real risk (a spoofed trusted address bypassing all content scanning), so whitelist stays a nudge that severe content can still override via the `confirmed` threshold — the same protection today's design has, just computed by the app instead of borrowed from rspamd.

## Capabilities

### New Capabilities

- `sender-lists`: whitelist/blacklist as an app-owned capability — IMAP-backed storage (read and write, per mailbox) for list membership, sender-address normalization, the blacklist-absolute vs. whitelist-score-nudge precedence, and how the scan workflow consults it relative to rspamd and AI.

### Modified Capabilities

- `state-manager`: extend the existing scanner-state read/write pattern so list state also supports **read** (today `writeMapState` exists but nothing reads it back) and gets its own missing-state default (empty list, not an error) — the same append-before-delete and newest-UID-wins guarantees already required for scanner state.
- `rspamd-external-storage`: remove every requirement describing map-file paths, the `rspamd/maps` mount, and `RSPAMD_WHITELIST_MAP_PATH`/`RSPAMD_BLACKLIST_MAP_PATH` — none of that plumbing exists once rspamd is purely a stateless content scorer. The rspamd data/logs and Redis bind-mount requirements are unaffected.
- `scan-inbox`: add the pre-rspamd blacklist check, the post-rspamd whitelist score adjustment, and the new 4-tier (`clean`/`low`/`high`/`confirmed`) threshold-driven categorization that replaces the current dependence on rspamd's `action === 'reject'` verdict.

## Impact

- **Code**: `src/lib/utils/rspamd-maps.js` (replaced by IMAP-backed list storage, likely folded into or alongside `state-manager.js`), `src/lib/workflows/scan-workflow.js`, `src/lib/workflows/map-workflow.js`, `src/lib/services/map-service.js`, `src/lib/utils/email-parser.js` (`isWhitelisted`/`isSpam` derivation from rspamd symbols/action removed — rspamd's parsed output becomes just `score`/`required`), `src/lib/utils/spam-classifier.js` (new 4-tier thresholds, blacklist override, whitelist score-adjustment), `src/state-manager.js`, `src/lib/utils/config.js` (drop `RSPAMD_WHITELIST_MAP_PATH`/`RSPAMD_BLACKLIST_MAP_PATH`; add `SPAM_CLEAN_THRESHOLD`/`SPAM_LOW_THRESHOLD`/`SPAM_HIGH_THRESHOLD`/`SPAM_CONFIRMED_THRESHOLD`).
- **Config**: `rspamd/config/multimap.conf` (delete both rules), `docker-compose.yml` and `bin/local/docker-compose.yml` (drop maps mount + map path env vars on both compose files, both services).
- **Tests**: `test/rspamd-maps.test.js` replaced by tests for the new IMAP-backed list store; `test/scan-workflow.test.js`, `test/spam-classifier.test.js`, `test/email-parser.test.js`, `test/state-manager.test.js` updated for the new bucketing/precedence behavior.
- **Operators**: no more `SPAM_SCANNER_DATA/rspamd/maps/*.map` files to inspect or back up manually — list contents live in each mailbox's own state folder, visible/recoverable the same way scanner state already is. rspamd can now safely be pointed at by more than one mailbox scanner instance without cross-contaminating list data.
