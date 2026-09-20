# Design

## Context

See `proposal.md` for motivation. Key constraints established during design discussion, not repeated there in full:

- rspamd's `checkv2` response includes `required_score`, which is its _add-header_ threshold, not its `reject` threshold — confirmed by `test/email-parser.test.js` fixtures showing `required_score` constant across `add header`/`reject`/`greylist` responses with different `score`s. The app has never had visibility into rspamd's real reject cutoff, and can't reconstruct it from anything in the response.
- The goal is a single rspamd instance shared across multiple IMAP-mailbox scanner instances. Anything rspamd reads from local disk (a map file) is necessarily global to every mailbox sharing it — there is no per-request/per-tenant map lookup in rspamd's multimap module. rspamd must become a pure, stateless content scorer.
- `state-manager.js` already has a working append-before-delete, newest-UID-wins pattern for scanner state (`writeScannerState`/`readScannerState`) and a half-built write path for map state (`writeMapState`, never read back). This change completes that symmetry for lists rather than inventing a new storage mechanism.

## Goals / Non-Goals

**Goals:**

- rspamd receives no list/mailbox-identifying information and reads nothing from disk that this project controls.
- Blacklist and whitelist are both scoped per mailbox, stored and read from that mailbox's own IMAP state folder.
- Preserve every behavioral guarantee the current design has: rspamd (now: severe score) can still override a whitelist match; AI never sees blacklisted/confirmed mail; AI can never escalate a message to `confirmed`; whitelisted mail that isn't overridden by severity never reaches AI.
- Close the "listed on both maps cancels to net zero" bug with an explicit, deterministic precedence.

**Non-Goals:**

- Multi-mailbox / multi-tenant scanning itself is out of scope here — this change only removes the architectural blocker (rspamd-side per-tenant state) so that work can happen later without revisiting list matching.
- No changes to the AI escalation thresholds/logic (`applyAiEscalation`, `AI_ESCALATE_TO_*`) beyond feeding it the same shape of input it gets today. That machinery belongs to the separate, in-flight `ai-spam-escalation` change.
- No change to DKIM/DMARC-authenticated whitelisting (tracked separately as roadmap 4.1) — sender-address matching here has the same spoofing exposure the current multimap rule already has; this change doesn't add to or reduce that exposure for whitelist, and blacklist's exposure is low-severity by construction (see proposal.md).
- Collapsing or renaming the existing `nonSpamMessages`/`lowSpamMessages`/`highSpamMessages`/`spamMessages` bucket variable names / `FOLDER_SPAM` disposition is out of scope — only how membership in the top tier (`confirmed`) is decided changes, not the bucket's name or downstream handling.

## Decisions

### 1. Blacklist is a flat override; whitelist is a score adjustment (asymmetric by design)

Alternatives considered:

- **Both as score adjustments** (mirroring today's multimap `±20` exactly, in app code, on rspamd's content-only score): rejected because a purely arithmetic blacklist bump doesn't guarantee an override (could theoretically fail to cross `SPAM_CONFIRMED_THRESHOLD` for content that also scores very cleanly) — it reintroduces the same category of "not actually verified, just usually works" problem the proposal set out to fix for blacklist.
- **Both as flat overrides** (skip rspamd/AI entirely for both): rejected because it removes rspamd's ability to catch a spoofed whitelisted sender's malicious content — the exact spoofing regression identified mid-design.
- **Chosen: blacklist flat, whitelist adjusted.** Blacklist is meant to be an absolute, user-curated "never trust this sender" instruction; a false positive (a spoofed look-alike address getting blocked) is low-cost. Whitelist is a trust bias, not a certainty; keeping it as a score nudge that severe content can still override preserves the exact safety property today's design has (rspamd's own verdict can override a whitelist entry), just recomputed with an app-owned threshold instead of rspamd's hidden one.

### 2. Four-tier categorization uses three thresholds, not four

Working through the exact boundary math surfaced that the originally-discussed `SPAM_HIGH_THRESHOLD` (100) was vestigial even in the current code — `categorizeMessages`' existing `highProbableThreshold` branch and its "default" fallthrough already produce the same bucket on both sides of that value. Four contiguous tiers need exactly three boundaries. Final thresholds, all newly wired into `config.js` (previously hardcoded, unconfigurable function-parameter defaults):

| Env var                    | Default | Boundary             |
| -------------------------- | ------- | -------------------- |
| `SPAM_CLEAN_THRESHOLD`     | `30`    | `clean` / `low`      |
| `SPAM_LOW_THRESHOLD`       | `60`    | `low` / `high`       |
| `SPAM_CONFIRMED_THRESHOLD` | `200`   | `high` / `confirmed` |

`SPAM_CONFIRMED_THRESHOLD` defaults to `200` (double `required_score`) rather than `250` (which would more closely mirror stock rspamd's actual `reject`/`add_header` ratio of ~2.5x) — deliberately slightly more aggressive, because the cost of under-flagging (a message merely sits in `high`, still visible/labeled) is much lower than over-flagging (a message — possibly from a compromised whitelisted sender — gets moved out of the inbox unseen).

### 3. `isBlacklisted`/`isWhitelisted` are computed once per message, before rspamd's response is used

The scan workflow needs the sender's list membership regardless of rspamd's response (blacklist gates whether rspamd is even called; whitelist adjusts how its response is interpreted). Both lookups read the same in-memory list snapshot, loaded once per `runScan` invocation (not per batch, not per message) — the underlying IMAP-backed state doesn't change mid-scan, and re-reading it per message would be wasteful. This mirrors how `config` itself is loaded once at process start.

### 4. List storage shape

Reuse the existing state-message-per-key pattern (`X-App-State` header, append-before-delete, newest-UID-wins) rather than inventing a new folder or encoding. Each mailbox's whitelist and blacklist are stored as two state messages (`STATE_KEY_WHITELIST_MAP`/`STATE_KEY_BLACKLIST_MAP`, keys already defined in `config.js`) in the existing `FOLDER_STATE` folder, holding a JSON array of normalized addresses (replacing today's newline-delimited map-file format, which existed only because rspamd's multimap module required it — no longer a constraint once rspamd never reads it).

### 5. Migration is a one-time import script, run offline, taking a plain file argument

List state is stored and read as JSON only. Anything a read finds that isn't valid JSON for a given list key — including the legacy newline-delimited plain-text content `writeMapState` has already been backing up write-only, since before this change — is treated exactly like a missing state message (empty list), not parsed or migrated implicitly. This keeps the read path uniform (`state-manager`'s existing "missing state defaults to empty" behavior already covers it; no separate branch needed) and makes migration something that only happens when explicitly invoked.

Migrating existing local `whitelist.map`/`blacklist.map` content is handled by a small, explicit CLI script (`src/admin/import-list.js`, alongside the existing `src/admin/uid-on-date.js` — an operator/maintenance script, not an orchestrator step), using `yargs` (already a dependency, already used by `uid-on-date.js` for exactly this kind of one-off admin CLI) to parse its arguments: which list (`whitelist`/`blacklist`), a source file path, and a mode (`append`/`override`). The source file path is a plain CLI argument — the script has no dependency on `RSPAMD_WHITELIST_MAP_PATH`/`RSPAMD_BLACKLIST_MAP_PATH` or any Docker mount; it can be pointed at any file the operator can read, including one copied out of a container or off `${SPAM_SCANNER_DATA}/rspamd/maps/` by hand. `.env` still supplies IMAP credentials and the state-folder/key configuration the script writes through — the same `newClient()`/`config` the rest of the app uses — just not the input file's location.

This is a single-operator, single-mailbox deployment, so migration doesn't need to be a zero-downtime, both-systems-active rollout — the scanner is simply stopped, the script is run once per list, and the scanner is restarted on the new code. `append` covers the common case (preserve everything already trained); `override` is there for a deliberate clean re-sync — both are explicit choices rather than the script guessing.

Alternatives considered:

- **A dual-format reader** that tries JSON first and falls back to parsing the legacy plain-text backup. Rejected — it would make a legacy-format parser a _permanent_ part of the hot read path, and depends on that pre-existing backup being current, which isn't guaranteed; treating non-JSON as simply absent is both simpler and reuses an already-required behavior.
- **Deriving the import file path from `RSPAMD_WHITELIST_MAP_PATH`/`RSPAMD_BLACKLIST_MAP_PATH`**, matching the app's other config. Rejected — those env vars and the mount they implied are exactly what this change removes; keeping the import script dependent on either would reintroduce the coupling the rest of the change eliminates, for a script that only ever runs once.
- **A live parallel-run migration** (ship both systems active, import while the old multimap config still serves traffic, cut over once validated). Rejected as more process than this deployment needs.

## Risks / Trade-offs

- **[Risk] Loading the full list into memory once per scan assumes list size stays small** (hundreds to low thousands of addresses, realistic for a personal/small-team mailbox). → Mitigation: none needed at this scale; flag as a scaling limit if a future multi-tenant deployment trains lists an order of magnitude larger.
- **[Risk] `SPAM_CONFIRMED_THRESHOLD=200` is a judgment call, not derived from a measured rspamd reject rate for this mailbox.** → Mitigation: it's a real env var now (previously not configurable at all), so it can be tuned from observed false-positive/negative rates after rollout without a code change.
- **[Trade-off] Blacklist/whitelist asymmetry is more conceptually complex than "both work the same way".** → Accepted: the asymmetry is what makes the design correct under the spoofing constraint; documented explicitly in `sender-lists`'s spec and in proposal.md so it doesn't read as an oversight later.
- **[Risk] Skipping the import step silently yields an empty whitelist/blacklist**, not an error ("no matches when no list state exists yet" is by-design behavior for a mailbox with nothing trained). → Mitigation: the Migration Plan below makes the import an explicit, ordered step before cutover, not an optional afterthought; `append` mode also makes it safe to run late if it's missed the first time.
- **[Risk] Import must still happen before the source `.map` file becomes unreachable** (e.g. its host directory is cleaned up later), even though the script itself has no mount/env-var dependency. → Mitigation: the Migration Plan runs the import while the file is still where the operator expects it, as the first real step after stopping the scanner; the file can also be copied anywhere reachable beforehand since the script takes any path.

## Migration Plan

Single-operator, single-mailbox deployment — a brief scan pause during migration is acceptable, so this is a stop/import/cutover sequence rather than a live parallel-run:

1. Stop the scanner (`docker compose stop spam-scanner`, or equivalent).
2. On the new code, run `src/admin/import-list.js` once for each list that has existing entries (`whitelist` and/or `blacklist`), pointing it at wherever that list's `.map` file currently is on disk (e.g. `${SPAM_SCANNER_DATA}/rspamd/maps/whitelist.map`, copied out or read directly — the script doesn't care, it's just a file argument). Use `append` (the normal case — nothing to conflict with on a first run) or `override` if a clean re-sync from the file is intended. Confirm the imported count matches the source file's address count.
3. Deploy the rest of the cutover: remove `multimap.conf`'s two rules and the docker-compose map mounts/env vars (they're only meaningful together — the import script never depended on them, so this can happen in the same deploy as step 2 without sequencing risk).
4. Restart the scanner.
5. Rollback: revert the deploy; `multimap.conf` and the map-file mounts are restored from git/compose history. Local `.map` files, if still present on disk, are untouched by this change (nothing in it deletes them) and remain valid for rspamd's old multimap rules to read again immediately on rollback.
