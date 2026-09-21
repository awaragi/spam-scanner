# spam-scanner — Roadmap (Open Items)

- **Original review date:** 2026-09-17
- **Last cleanup:** 2026-09-21 — resolved findings removed from the body for clarity; see
  [Resolved log](#resolved-log) for a one-line summary of each, or `git log`/`git blame` on
  this file for the full write-up that used to live here.

---

## How to read this document

Every finding has a **stable number** (`<section>.<item>`, e.g. `4.7`) so it can be
referenced in issues, commits and openspec changes. Numbers are not resequenced when items
are resolved and removed — a gap in the sequence just means that finding is closed (see the
[Resolved log](#resolved-log)).

Findings are **grouped by severity** (sections 2–5, numbered `3.x`/`4.x`/`5.x`/`6.x`
respectively — that numbering predates this document's own section numbers and is kept as
the stable ID). Each finding carries:

| Field          | Meaning                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Area**       | Review aspect (see legend below) — section 7 re-indexes all findings by area                                             |
| **Where**      | Files / lines                                                                                                            |
| **Complexity** | Estimated work to fix: **XS** < 1 h · **S** 1–4 h · **M** 0.5–2 days · **L** 3–5 days · **XL** > 1 week                  |
| **(verify)**   | Marked when the finding is inferred from reading code/config and should be confirmed against a live system before acting |

**Severity legend**

| Severity     | Meaning                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| **Critical** | Can silently mis-handle a large amount of mail or expose the system; fix before anyone else installs it |
| **High**     | Real bug, security weakness, or a blocker for a first-time / less-technical installer                   |
| **Medium**   | Correctness edge cases, maintainability debt, missing guard-rails, significant doc gaps                 |
| **Low**      | Cleanup, style, polish, nice-to-have                                                                    |

**Area legend**

| Code | Area                                        |
| ---- | ------------------------------------------- |
| REF  | Refactoring & modularity                    |
| CLN  | Clean-up / dead code                        |
| DOC  | Documentation                               |
| DEP  | Build, deployment & first-time installation |
| MAP  | Whitelist / blacklist maps                  |
| RSP  | Rspamd setup                                |
| SEC  | Security, secrets & privacy                 |
| REL  | Reliability & failure modes                 |
| CFG  | Configuration design                        |
| TST  | Testing                                     |
| TLG  | Dependencies & tooling                      |
| OPS  | Operability (health, logs, backup)          |
| HYG  | Repository hygiene                          |
| UX   | End-user workflow                           |
| LIC  | Licensing & project metadata                |

---

## Table of Contents

1. [Executive summary](#1-executive-summary)
2. [Critical findings](#2-critical-findings)
3. [High findings](#3-high-findings)
4. [Medium findings](#4-medium-findings)
5. [Low findings](#5-low-findings)
6. [Deep dives](#6-deep-dives)
   - 7.1 Whitelist / blacklist redesign proposal
   - 7.2 Rspamd configuration simplification proposal
   - 7.3 First-time installation proposal (less-technical users)
   - 7.4 Documentation restructure proposal
7. [Index of findings by area](#7-index-of-findings-by-area)
8. [Suggested roadmap](#8-suggested-roadmap)
9. [Resolved log](#resolved-log)

---

## 1. Executive summary

The core design is sound: incremental UID scanning, state stored in the mailbox,
folder-based training that needs no UI, a clean escalate-only AI safety net with good
tests, and a pluggable processor strategy.

The main risks still open are concentrated in three places:

1. **Security of the default deployment** — the whitelist/blacklist match on the
   spoofable envelope `From` address with no authentication requirement (4.1); rspamd
   receives no envelope data (IP/HELO/MAIL FROM), weakening SPF and IP-based DNSBL checks
   (4.10, verify).
2. **First-time installation** — no published image or guided installer (4.15), the
   backup/restore/upgrade story is incomplete (5.21), and provider compatibility
   (Gmail/Outlook/OAuth2, IMAP keyword visibility) is undocumented (5.22).
3. **Maintainability & operability** — no CI (5.17), no config validation (5.10), gaps in
   IMAP-facing test coverage and no end-to-end smoke test (5.16), and no heartbeat/health
   signal for monitoring (5.23).

**Top actions by value/effort**

| #   | Action                                                                 | Findings  | Complexity |
| --- | ---------------------------------------------------------------------- | --------- | ---------- |
| 1   | Require an authenticated-sender symbol before trusting a whitelist hit | 4.1, 7.1  | S          |
| 2   | Config schema + validation (single source of truth)                    | 5.10      | M          |
| 3   | GitHub Actions CI (lint, format:check, test, docker build); Renovate   | 5.17      | S          |
| 4   | `doctor` command (config/IMAP/rspamd connectivity checks)              | 5.10, 7.3 | M          |
| 5   | Publish multi-arch image to GHCR + `install.sh` wizard                 | 4.15, 7.3 | L          |
| 6   | Single `spam-scanner` CLI binary with subcommands                      | 5.14      | M          |
| 7   | Fill IMAP-facing test coverage gaps; add an e2e smoke test             | 5.16      | L          |
| 8   | Heartbeat file + generalized failure notifier                          | 5.23      | M          |

---

## 2. Critical findings

None open — both original critical findings (3.1, 3.2) are resolved. See the
[Resolved log](#resolved-log).

---

## 3. High findings

### 4.1 Whitelist/blacklist trust the spoofable `From:` header

- **Area:** MAP, SEC, RSP · **Complexity:** S (auth requirement) / M (full redesign, see 7.1)
- **Where:** `src/lib/services/sender-lists.service.js` (`senderAddressOf`);
  `src/lib/services/spam-classifier.service.js`;
  `src/lib/controllers/steps/sender-list-lookup.step.js`, `ai-classification.step.js`

**Problem.** Whitelist/blacklist matching is app code (moved off rspamd's multimap by a
prior fix) but still matches on the message's envelope `From` address with **no
authentication requirement**. A whitelist hit applies **−20** to rspamd's score and skips
the AI safety net. Phishing that forges the `From:` of a whitelisted contact (bank,
employer, family member) — the most common phishing pattern — still lands with a
discounted score and no AI check. The blacklist has the mirror problem: spam that forged a
legitimate address gets that innocent address blacklisted.

**Recommendation.**

1. Before trusting a whitelist hit, require an authenticated-sender symbol from rspamd's
   own check response (e.g. `DMARC_POLICY_ALLOW` / `R_DKIM_ALLOW` in the `/checkv2` result
   already fetched by `rspamd-check.step.js`) rather than only the raw envelope `From`.
2. Keep the whitelist's −20 adjustment only for authenticated hits; for an unauthenticated
   match, apply a smaller adjustment (or none) so a strongly spammy spoofed message can
   still reach `confirmed`.
3. Keep the AI bypass only for authenticated whitelist hits.
4. For blacklist extraction (`train.blacklist` folder), prefer the authenticated `From`
   domain / `Return-Path` and don't add addresses from `Reply-To` (commonly a victim's or a
   free-mail address in scams). See 7.1.

### 4.10 Rspamd receives no envelope data (IP / HELO / MAIL FROM) (verify)

- **Area:** RSP · **Complexity:** M
- **Where:** `src/lib/clients/rspamd.client.js`; `src/lib/utils/email-parser.util.js`

**Problem.** Messages are posted to `/checkv2` as raw bytes with no `IP`, `Helo`, `From`,
`Rcpt` or `Hostname` headers. Rspamd therefore can't evaluate SPF properly, can't run
IP-based RBL/DNSBL checks against the real sending relay, and DMARC evaluation is weakened
— a large portion of rspamd's accuracy. It also reduces the value of 4.1's authentication
requirement (DKIM still works; SPF does not). (verify by inspecting symbols in rspamd
history for a scanned message: expect `R_SPF_NA`/missing IP-based symbols.)

**Recommendation.** Parse the first `Received:` header added by the mailbox provider's MX
(configurable trusted hop count or trusted hostnames) to obtain the connecting IP and HELO;
pass them as `IP` / `Helo` request headers, plus `From` (Return-Path) and `Rcpt` (IMAP
user). Alternatively configure rspamd's `external_relay` module to extract it server-side.
Add fixtures to tests.

### 4.15 No pre-built image and no guided installer

- **Area:** DEP · **Complexity:** L
- **Where:** `Dockerfile`

**Problem.** Installing today requires: cloning the repo, understanding Compose variable
interpolation, creating a data directory with correct permissions, hashing an rspamd
password by hand, discovering the server's folder delimiter and Junk folder name, building
an image locally, and reading logs to find out whether it worked. That's beyond a
less-technical user.

**Recommendation.** See full proposal in **7.3**: publish multi-arch images to GHCR from
CI, ship a standalone `compose.yaml` + `install.sh` wizard, add a `doctor` command, and
document provider-specific steps.

---

## 4. Medium findings

### 5.2 Maps have no domain-entry support or per-entry removal path

- **Area:** MAP, UX, OPS · **Complexity:** M
- **Where:** `src/lib/services/sender-lists.service.js`; `src/admin/import-list.js`

**Problem.** Whitelist/blacklist are now IMAP-backed and app-owned (mailbox is the real
source of truth), but:

- Entries are exact addresses only — no domain entries (`@example.com`), no comments.
- The only way to remove a mistaken entry is `src/admin/import-list.js --mode override`,
  which wholesale-replaces a list from a corrected file — there's no "remove just this one
  address" command.

**Recommendation.** See **7.1** (domain entries, a dedicated removal folder/command).

### 5.3 Ham-trained messages can be re-escalated by AI (training loop)

- **Area:** UX, REL · **Complexity:** S
- **Where:** `src/lib/controllers/workflows/train.controller.js`;
  `src/lib/controllers/steps/ai-classification.step.js`

**Problem.** Messages in `train.ham` are learned as ham, then **moved back to INBOX**,
where they receive a new UID greater than `last_uid` and are scanned again. Bayes will
lower the rspamd score, but the AI net is independent of Bayes: if the AI still scores it ≥
threshold, the message is labelled/moved to `spam.low`/`spam.high` again. In `folder` mode
the user sees the message they just rescued disappear again. The same applies to
whitelist-trained messages if the sender isn't authenticated after 4.1.

**Recommendation.** When training ham, tag the message with an IMAP keyword (e.g.
`$ScannerHam`) before moving it back; the scan workflow skips (or never escalates)
messages carrying it. Alternatively record their Message-IDs in state for N days.

### 5.6 Unbound resolver container is started but not used by rspamd (verify)

- **Area:** RSP · **Complexity:** XS
- **Where:** `docker-compose.yml`; `rspamd/config/options.inc`

**Problem.** `options.inc` only sets `control_socket`; there is no `dns { nameserver =
[...] }` pointing to `unbound`. Rspamd therefore uses the container's `/etc/resolv.conf`
(Docker's embedded DNS → host resolver, often a public resolver). Public resolvers are
blocked by Spamhaus and other DNSBLs, which return "blocked" codes rather than real
results — degrading accuracy and occasionally producing false positives. (verify via
`rspamadm configdump options` inside the container.)

**Recommendation.** Add to `options.inc`: `dns { nameserver = ["unbound:53"]; }` (verify
syntax for the rspamd version), or remove the unbound service if not wanted. Document why a
local recursive resolver matters.

### 5.7 Compose files aren't de-duplicated; no scanner-level healthcheck

- **Area:** DEP, OPS, REL · **Complexity:** S
- **Where:** `docker-compose.yml`, `bin/local/docker-compose.yml`

**Problem.** Image pinning, healthchecks (rspamd/redis) and `depends_on:
condition: service_healthy` are already in place. Still missing: the two compose files
(production and dev) aren't de-duplicated via a base + override, and the spam-scanner
service itself has no healthcheck — there's no heartbeat file yet for `docker ps` to
check against (blocked on 5.23).

**Recommendation.** De-duplicate via `compose.yaml` + `compose.dev.yaml`. Add a
scanner-level healthcheck once 5.23 lands.

### 5.8 PUID/PGID override support; host-directory ownership on Linux unverified

- **Area:** SEC, DEP · **Complexity:** S
- **Where:** `Dockerfile`; `docker-compose.yml`

**Problem.** The spam-scanner container itself now runs as `USER node`, non-root, and
writes nothing to the host data dir (whitelist/blacklist moved into IMAP state). Not
re-verified: rspamd's and Redis's own bind-mount ownership behavior against
host-created directories on Linux (Docker Desktop on macOS masks permission issues that
show up on Linux). No `PUID`/`PGID` override support exists for users who need a specific
host-side UID.

**Recommendation.** Verify rspamd/redis bind-mount ownership on a real Linux host; add
`PUID`/`PGID` support if that turns out to be needed; document SELinux `:z`.

### 5.10 No configuration validation; config read at import time

- **Area:** CFG, REF · **Complexity:** M
- **Where:** `src/lib/core/config.js`; `src/cli/orchestrator.js`;
  `src/lib/clients/ai.client.js`

**Problem.**

- Only `IMAP_HOST`/`IMAP_USER` are checked (in the orchestrator only — admin/train
  scripts don't check). `IMAP_PASSWORD` missing → cryptic IMAP auth error.
- `parseInt` results aren't checked (`SCAN_INTERVAL=5m` → `NaN` → `setTimeout(NaN)` →
  tight loop).
- Invalid `SPAM_PROCESSING_MODE` only fails at first scan, after training ran.
- `AI_ENABLED=true` without `AI_API_KEY` against the default OpenAI URL isn't caught
  until failures accumulate.
- `AI_ESCALATE_TO_LOW_THRESHOLD > AI_ESCALATE_TO_HIGH_THRESHOLD` isn't rejected.
- `config` and the OpenAI client are created at import time, which forces tests to mock
  modules and prevents running with alternative configs.

**Recommendation.** Introduce a declarative schema (hand-rolled table or `zod`/`envalid`)
with type, default, allowed values, description, `secret: true`. Validate once at startup
and exit with a readable list of all problems. Export a `loadConfig(env)` function; build
clients from config via small factories. The same schema drives docs generation and
redaction.

### 5.13 Training/map workflows load entire folders into memory

- **Area:** REL · **Complexity:** S
- **Where:** `src/lib/clients/imap.client.js` (`fetchAllMessages`);
  `src/lib/controllers/workflows/train.controller.js`;
  `src/lib/controllers/workflows/sender-list-training.controller.js`

**Problem.** `fetchAllMessages` downloads full sources of every message in the folder
before processing. A user bulk-dragging a few thousand old spams (a very natural first
action to "train" the filter) can exhaust container memory, and a failure mid-way repeats
the whole download.

**Recommendation.** Search UIDs, then fetch/train/move in `PROCESS_BATCH_SIZE` chunks (the
scan workflow already does this). For map training only headers are needed — fetch
`headers` instead of `source`.

### 5.14 Entry-point boilerplate — no single CLI binary

- **Area:** REF, CLN, UX · **Complexity:** M
- **Where:** `src/cli/*.js`, `src/admin/*.js`

**Problem.** Scripts now consistently follow `newClient()` → `connect()` → run →
`safeLogout()` in a `finally` block (per `CLAUDE.md`'s documented convention), but there
is still no unified `spam-scanner` binary with subcommands — each script is invoked
individually via `node src/cli/....js`. In Docker, running an admin task requires knowing
`docker compose exec spam-scanner node src/admin/…`.

**Recommendation.** One CLI (`src/cli.js`, `yargs` is already a dependency) with
subcommands: `run` (orchestrator), `scan`, `train spam|ham|whitelist|blacklist`, `init`,
`doctor`, `state show|set|reset|delete|from-date`, `maps list|add|remove|restore`,
`export-email --uid|--message-id`, `folders list`. Shared `withImap(fn)` helper for
connect/logout/error handling. Add `"bin": {"spam-scanner": "src/cli.js"}` and a Docker
usage line `docker compose exec spam-scanner spam-scanner doctor`.

### 5.16 Test coverage gaps on IMAP-facing code; no e2e test

- **Area:** TST · **Complexity:** M–L

**Problem.** Every module under `src/lib/` now has a matching `test/unit/` file (47 test
files, 414 tests, all green), with coverage tooling (`npm run test:coverage`) wired up.
Still open:

- No CI to run `test:coverage` automatically or gate a threshold on it (blocked on 5.17).
- No end-to-end smoke test against a real IMAP server — `test/integration/` contains only
  a live-AI-provider test. A GreenMail/Dovecot + rspamd-in-Compose smoke test (create
  mailbox, drop fixtures, run one cycle, assert folders/labels/state) was never built.
- `src/cli/orchestrator.js` itself — the mode loop (single-run/poll/IDLE selection),
  `MAX_RETRIES` backoff, and `SIGTERM`/`SIGINT` handling — has no dedicated unit test; the
  pieces it calls are each tested in isolation, but the loop wiring them together isn't.
- `imap.client.js`'s coverage (55–71% depending on how it's sliced) is the largest
  untested surface left in `src/lib/`, pulled down by IDLE/reconnect branches.

**Recommendation.**

- Once CI exists (5.17), run `test:coverage` in it and gate on a threshold.
- Add the GreenMail/Dovecot + rspamd Compose smoke test, run on demand or nightly (not on
  every push — it's slow).
- Add a focused unit test for `src/cli/orchestrator.js`'s loop/retry/shutdown logic,
  injecting fake workflow controllers via `ctx`.
- Fill in `imap.client.js`'s IDLE/reconnect branch coverage.

### 5.17 No CI; Prettier not fully applied; no Renovate/Dependabot

- **Area:** TLG, HYG · **Complexity:** S
- **Where:** `.github/`, `package.json`, `.prettierrc.json`, `eslint.config.js`

**Problem.** ESLint is now in place (`npm run lint`, 0 problems). Still missing:

- No GitHub Actions workflow: install → lint → format:check → test → docker build.
- No one-time Prettier-formatting commit for the still-non-conformant files (this doc's
  wide markdown tables aren't Prettier-clean either).
- No Dependabot/Renovate for npm, Docker base images and Compose images.

**Recommendation.** Add the CI workflow; run `npm run format` once, isolated, no logic
changes; add Renovate or Dependabot config.

### 5.18 `IMAP_TLS` insecure opt-in has no explicit gate

- **Area:** SEC, CFG · **Complexity:** XS
- **Where:** `src/lib/core/config.js`

**Problem.** `IMAP_TLS` now defaults to `true` (an explicit `false` is required to disable
it), but disabling it has no extra friction, and STARTTLS isn't enforced when connecting
on port 143 without TLS.

**Recommendation.** Require `IMAP_ALLOW_INSECURE=true` alongside `IMAP_TLS=false` and log
a warning; enforce `doSTARTTLS: true` in imapflow when connecting on 143 without TLS.

### 5.19 AI privacy & data-handling not documented

- **Area:** SEC, DOC · **Complexity:** S
- **Where:** `src/lib/clients/ai.client.js`, `.env.example`

**Problem.** When enabled, full plain-text bodies (up to ~24k chars) plus From/To/Subject
of every non-whitelisted, non-spam message are sent to a third party. Subjects, senders
and AI reasoning are logged at `info`. Neither is mentioned in user docs.
Prompt-injection from email bodies ("rate this 0") is mitigated by the escalate-only
design — worth stating as a deliberate property.

**Recommendation.** Add a "Privacy" section: what is sent, to whom, retention depends on
provider, recommend local models (Ollama) for sensitive mailboxes; move subject/from/
reasoning logging to `debug` or add `LOG_REDACT_PII=true`; document the
injection-resistance property.

### 5.20 Rspamd Bayes cold start (`min_learns`) not explained to users

- **Area:** RSP, DOC, UX · **Complexity:** XS (docs) / S (status command)
- **Where:** `rspamd/config/classifier-bayes.conf`

**Problem.** Rspamd's Bayes classifier doesn't contribute until it has learned a minimum
number of spam **and** ham messages (default 200 each). New users who train 20 spams will
see no effect and conclude the tool doesn't work.

**Recommendation.** Make `min_learns` explicit in `classifier-bayes.conf` with a comment;
document "train ≥ 200 spam and ≥ 200 ham"; add a `spam-scanner status` command that shows
learned counts from `GET /stat` and map sizes.

### 5.21 Backup / restore / upgrade story is incomplete

- **Area:** OPS, DOC · **Complexity:** S
- **Where:** `README.md`

**Problem.** The real state to back up is `${SPAM_SCANNER_DATA}` (Redis Bayes DB, rspamd
data) + IMAP state folder (whitelist/blacklist/scanner state) + `.env` + any local rspamd
config edits. Redis snapshot consistency isn't addressed. No upgrade procedure (image
tags, rspamd major upgrades, Bayes schema).

**Recommendation.** Document: stop stack (or `redis-cli BGSAVE`) → `tar` the data dir +
`.env`; restore = untar + up. Add `bin/backup.sh`/`restore.sh` (or CLI subcommands). Add
"Upgrading" section tied to pinned versions.

### 5.22 Provider compatibility (Gmail, Outlook, OAuth2, keywords) undocumented (verify)

- **Area:** UX, DOC, DEP · **Complexity:** S (docs) / L (OAuth2)

**Problem.**

- Gmail requires an app password (with 2FA) or OAuth2; Microsoft consumer/365 accounts
  have largely disabled basic auth for IMAP → only OAuth2 works. `imapflow` supports
  `accessToken`, but the app has no OAuth flow.
- `label` mode sets IMAP keywords (`Spam:Low`). Gmail does not expose arbitrary keywords
  as labels (it uses `X-GM-LABELS`), and many clients (Apple Mail, Outlook, most mobile
  apps) don't display keywords at all; Thunderbird does. (verify per provider.) For most
  users `folder` mode is the only visible option.
- Folder delimiter/namespace differences and Junk folder naming across providers.

**Recommendation.** A provider matrix in docs (Dovecot/cPanel, Fastmail, Gmail, iCloud,
Outlook/365, Proton Bridge): auth method, delimiter, Junk folder, whether keywords are
visible, recommended `SPAM_PROCESSING_MODE`. OAuth2 support as a later feature.

### 5.23 No operational visibility (health, heartbeat, summary)

- **Area:** OPS · **Complexity:** S–M

**Problem.** The only signals are JSON logs. There's no way for Docker, an uptime
monitor, or the user to know the scanner is alive and processing. The AI-failure alert
pattern exists (posts an INBOX notice) but isn't generalized to other failures (rspamd
down, IMAP auth failing, `MAX_RETRIES` exit, stuck batch).

**Recommendation.**

- Write a heartbeat file (`/tmp/heartbeat` with last successful cycle timestamp) → Docker
  `healthcheck`.
- Generalise the AI-failure-tracker pattern into a `failure-notifier` covering
  rspamd/IMAP/scan failures (INBOX notice, rate-limited).
- Optional: daily/weekly digest message ("scanned N, spam N, low N, high N, AI
  escalations N, Bayes learned N/N").
- Optional: `HEALTHCHECK_URL` ping (healthchecks.io-style) after each successful cycle.

### 5.27 No script to bootstrap `.env` for a new install

- **Area:** DEP, UX · **Complexity:** S
- **Where:** `.env.example`; `README.md`; `bin/local/hash-rspamd-password.sh`

**Problem.** Getting started requires manually `cp .env.example .env`, then
hand-editing IMAP credentials, `SPAM_SCANNER_DATA` (an absolute path), and
`RSPAMD_PASSWORD`, and separately remembering to run
`bin/local/hash-rspamd-password.sh` afterwards so the password and its hash don't drift
apart. None of the existing scripts create or populate `.env` itself — they all assume it
already exists and is correct.

**Recommendation.** Add a small `bin/setup-env.sh`:

1. Copy `.env.example` to `.env` if missing (refuse to overwrite an existing `.env`
   without `--force`).
2. Prompt for `IMAP_HOST`/`IMAP_PORT`/`IMAP_USER`/`IMAP_PASSWORD` (hidden input) and
   `SPAM_SCANNER_DATA` (default `~/.spam-scanner`), writing them into `.env` in place.
3. Generate a random `RSPAMD_PASSWORD`, write it into `.env`, then call
   `bin/local/hash-rspamd-password.sh` automatically so `RSPAMD_PASSWORD` and
   `worker-controller.inc` are generated together and never drift.
4. Support a non-interactive mode (flags or env vars) for CI/scripted installs.

This is a much smaller, independently shippable slice of the full `install.sh` wizard in
**7.3.3** — it needs no published images or `doctor` command to already be useful, and
7.3.3 can later call it as a step.

### 5.28 No support for multiple mailboxes / accounts from one deployment

- **Area:** CFG, UX, REF · **Complexity:** M (multi-instance doc) / L
  (multi-account-in-one-process)
- **Where:** `src/lib/core/config.js` (single `IMAP_*`/`FOLDER_*`/`STATE_KEY_SCANNER`
  block, read once at import); `src/cli/orchestrator.js`; `docker-compose.yml` (single
  `spam-scanner` service)

**Problem.** The whole app models exactly one mailbox: one `IMAP_HOST`/`USER`/`PASSWORD`,
one set of `FOLDER_*`, one `STATE_KEY_SCANNER`, one `SPAM_SCANNER_DATA`, loaded once as a
module-level singleton. Anyone wanting to protect a second mailbox (a spouse's inbox, a
second domain, a shared support address) has no supported path today short of a second
full checkout with its own `.env`. Running two stacks side by side is now possible via
Compose project scoping (`-p`/`COMPOSE_PROJECT_NAME`), but nothing documents or automates
that pattern yet.

**Recommendation.** Two complementary options, not mutually exclusive:

1. **Multi-instance (near-term, no app code changes).** One container stack per mailbox,
   each with its own `.env`/data dir, using `-p`/`COMPOSE_PROJECT_NAME` plus the bootstrap
   script in 5.27 (`bin/setup-env.sh --output .env.family`,
   `bin/setup-env.sh --output .env.work`, then
   `docker compose -p spam-scanner-family --env-file .env.family up -d`). Document this
   pattern now — it's cheap and unblocks the common case immediately.
2. **Multi-account-in-one-process (longer-term).** Extend the config schema to accept an
   array of mailbox definitions (e.g. a `mailboxes.yaml` or `MAILBOXES=family,work` with
   per-prefix env vars) and have the orchestrator fan out a cycle per mailbox, each with
   its own IMAP connection and state key, optionally sharing rspamd/Bayes/maps. This
   depends on the config-schema work in 5.10 landing first — track it as a Phase 3
   feature, not a quick win.

### 5.29 No automated end-to-end validation of a fresh install

- **Area:** TST, DEP, OPS · **Complexity:** M
- **Where:** none exists today; related: 5.16, 7.3.4 (`doctor` command)

**Problem.** Nothing exercises the actual install path end-to-end — cloning the repo (or
pulling a published image, once 7.3.1 lands), producing a working `.env` (5.27), bringing
up rspamd/redis/unbound, confirming the app can log into IMAP, create its folders,
complete a scan cycle, and successfully train at least one spam/ham message. A regression
anywhere in that chain is currently caught only by a real user's first run failing.

**Recommendation.** Add a scripted "fresh install" acceptance test, runnable locally and
in CI:

1. Start from a clean checkout/temp dir with no pre-existing `.env` or
   `SPAM_SCANNER_DATA`; assert the failure mode is the intended one (clear error, not a
   crash) when `.env` is missing.
2. Run the `.env` bootstrap script (5.27) against a disposable IMAP test server
   (Dovecot/GreenMail) and a disposable data dir.
3. `docker compose up -d` and wait on healthchecks instead of a fixed sleep.
4. Run the app once in single-run mode; assert exit code 0, the expected folders now
   exist on the IMAP server, a success/heartbeat log line is present (5.23), and rspamd is
   reachable with an empty Bayes corpus (fresh install).
5. Drop one spam and one ham fixture into the training folders, run again, assert they
   moved and Bayes learned counts increased (5.20).
6. Tear the stack down and assert the data dir/volumes can be removed cleanly, with no
   root-owned leftovers.

Wire this as a nightly/on-demand GitHub Actions job once 5.17's CI exists, rather than on
every push (a Compose-based e2e run is slow). It also doubles as living documentation of
"what a working install looks like."

---

## 5. Low findings

### 6.5 `stripSpamHeaders` scans the whole message, not just headers

- **Area:** REL · **Complexity:** XS · **Where:** `src/lib/utils/email-parser.util.js`
- Body lines beginning with `x-spam-` are also removed, altering content sent to
  rspamd/Bayes. Stop at the first blank line.

### 6.6 `admin/read-email.js` requires editing hard-coded constants

- **Area:** CLN, UX · **Complexity:** XS · **Where:** `src/admin/read-email.js`
- UID `2201` and a real third-party Message-ID are committed. Make them CLI args (part of
  5.14); remove the Message-ID from history if considered sensitive.

### 6.7 Logger misuse in `admin/read-state.js`

- **Area:** CLN · **Complexity:** XS · **Where:** `src/admin/read-state.js`
- `logger.error('msg', err.message)` — pino drops the second arg. Use
  `logger.error({ error: err.message }, 'msg')`.

### 6.8 Buffer → UTF-8 string conversion may alter 8-bit messages (verify)

- **Area:** REL · **Complexity:** S · **Where:** `src/lib/clients/imap.client.js`
- `message.source.toString()` decodes as UTF-8; non-UTF-8 8-bit bodies (legacy Latin-1
  mail) get replacement characters before being posted to rspamd, changing Bayes tokens
  and fuzzy hashes. Post the original `Buffer` to rspamd; only decode for header parsing.

### 6.9 Orchestrator logout can mask the original error

- **Area:** REL · **Complexity:** XS · **Where:** `src/cli/orchestrator.js`
- Wrap `logout()` in try/catch. Obsolete if a single-IMAP-connection-per-cycle model is
  adopted (see 5.15 in the Resolved log for the layering it would build on).

### 6.10 AI alert `To:` uses `IMAP_USER`

- **Area:** UX · **Complexity:** XS · **Where:** `src/lib/services/alert-email.service.js`
- `IMAP_USER` is not always an email address (e.g. `pierre` on self-hosted Dovecot). Add
  `NOTIFY_ADDRESS` defaulting to `IMAP_USER` when it contains `@`.

### 6.11 `isHumanReadable` heuristics contain provider-specific constants

- **Area:** MAP, REF · **Complexity:** XS · **Where:** `src/lib/services/sender-lists.service.js`
- `lnk01.com`, `cyberimpact.com` hard-coded. Move to a configurable list (or a small data
  file) and document.

### 6.14 `.env.example` inline comments break shell-based loaders

- **Area:** CFG, DEP · **Complexity:** XS · **Where:** `.env.example`; `bin/local/start.sh`
- `AI_ESCALATE_TO_LOW_THRESHOLD=50   # nonSpam -> lowSpam`: Compose strips it, but
  `start.sh`'s loader keeps `50   # nonSpam -> lowSpam` as the value (works only because
  `parseInt` tolerates trailing text). Put comments on their own lines.

### 6.16 `SCAN_BATCH_SIZE` vs `PROCESS_BATCH_SIZE` naming is confusing

- **Area:** CFG · **Complexity:** XS
- One limits UIDs per scan pass, the other messages per rspamd/IMAP batch. Rename
  (`SCAN_MAX_PER_CYCLE`, `BATCH_SIZE`) with backward-compatible aliases, or document
  clearly.

### 6.18 `.gitignore` is a generic Node template (~150 lines)

- **Area:** HYG · **Complexity:** XS
- Trim to what applies; local AI-tool dirs (`.idea`, `.junie`, `.windsurf`, `.temp`)
  should be listed explicitly (`.windsurf` currently relies on a global ignore).

### 6.19 AI-assistant configuration sprawl

- **Area:** HYG · **Complexity:** XS
- `CLAUDE.md` now covers project conventions for Claude Code, but local dirs (`.junie`,
  `.windsurf`, `.idea`) still clutter the repo root, and there's no `CONTRIBUTING.md`
  stating openspec is the process of record. Consider one canonical `AGENTS.md`
  referenced by each tool-specific file, and keep tool-generated folders out of the repo
  root where possible.

### 6.20 Package metadata incomplete

- **Area:** LIC · **Complexity:** XS · **Where:** `package.json`
- Missing `"private": true` (prevents accidental publish), `"license"`, `description`,
  `repository`, `bin`, `start` script. Version is frozen at `1.0.0`; images are only
  tagged `latest`.

### 6.21 No CHANGELOG / release process

- **Area:** LIC, OPS · **Complexity:** S
- Adopt Conventional Commits (already mostly used: `feat:`, `chore:`, `fix:`, `refactor:`)
  with `release-please` or `changesets` to generate `CHANGELOG.md`, semver tags and
  matching image tags.

### 6.22 Third-party licence notes

- **Area:** LIC · **Complexity:** XS
- App deps are permissive (MIT/Apache-2.0) — compatible with the MIT licence. Docker
  images: rspamd Apache-2.0; Redis ≥ 7.4 is RSALv2/SSPL (Redis 8 adds AGPLv3). Fine for
  personal/self-hosted use, but mention it in docs and consider `valkey/valkey` (BSD) as a
  drop-in. Copyright year in `LICENSE` is 2025 — optionally `2025-2026`.

---

## 6. Deep dives

### 7.1 Whitelist / blacklist redesign proposal

**Today (as-built).** Whitelist/blacklist matching is app code; each list is stored as an
IMAP state message (mailbox is the source of truth) rather than a local map file — the
biggest structural change this proposal originally called for is already done.

**Still open:**

| #     | Change                                                                                                                                                                    | Complexity |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 7.1.2 | **Authenticated whitelist.** Require a DKIM/DMARC pass symbol from rspamd's response before trusting a hit (4.1); lower the weight for unauthenticated hits.              | S          |
| 7.1.3 | **Domain entries.** Support `@example.com`-style entries alongside exact addresses.                                                                                       | S          |
| 7.1.4 | **Extract one address, from `From:` only** (authenticated one when available). Drop `Reply-To`/`Sender` for blacklist.                                                    | XS         |
| 7.1.5 | **Removal folder** `scanner.train.unlist`: senders of messages dropped there are removed from both lists; message moved back to INBOX.                                    | S          |
| 7.1.6 | **Blacklist also trains Bayes as spam** (single user action does both).                                                                                                   | XS         |
| 7.1.7 | **Feedback**: tag processed messages with a keyword (`$ScannerWhitelisted`, `$ScannerNoSender`) and/or post a short weekly digest of list changes.                        | S          |
| 7.1.8 | **CLI**: `maps list / add / remove / export / import` for power users; comments allowed (`# added 2026-09-17 from msg <id>`).                                             | S          |
| 7.1.9 | **Simplify folder names**: `Scanner/Always allow`, `Scanner/Always block`, `Scanner/Not spam`, `Scanner/Is spam`, `Scanner/Remove from lists`. Helps non-technical users. | S          |

### 7.2 Rspamd configuration simplification proposal

Current `rspamd/config/` has several one-line or tiny files with no comments; the link to
`.env`, ports and data dirs lives only in Compose. (The controller-password linkage and
loopback-only port binding this proposal originally called for are already done.)

| #     | Recommendation                                                                                                                                                                                                  | Complexity |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 7.2.1 | Add a header comment to each file: purpose, what may be changed, related env/compose settings.                                                                                                                  | XS         |
| 7.2.2 | Add `rspamd/config/README.md` explaining: `local.d` override model, which file does what, how to view effective config (`rspamadm configdump`), how to test a message (`check-eml`).                            | S          |
| 7.2.3 | `options.inc`: `dns { nameserver = ["unbound:53"]; }` (5.6).                                                                                                                                                    | XS         |
| 7.2.4 | `classifier-bayes.conf`: explicit `min_learns`, `autolearn = false` (training is user-driven), comment on Redis backend.                                                                                        | XS         |
| 7.2.5 | Explicit `actions.conf` (`reject`, `add_header`, `greylist` thresholds) so the scanner's low/high thresholds can be reasoned about next to them.                                                                | XS         |
| 7.2.6 | Pass envelope data (4.10) or configure `external_relay`.                                                                                                                                                        | M          |
| 7.2.7 | Provide `spam-scanner status` using `/stat` (Bayes counts, uptime, scanned) and `spam-scanner check <file.eml>` replacing `check-eml.sh`.                                                                       | S          |
| 7.2.8 | Consider mounting individual config files instead of the whole `local.d` directory so image-provided `local.d` defaults (if any) aren't hidden. (verify contents of `/etc/rspamd/local.d` in the pinned image.) | XS         |

### 7.3 First-time installation proposal (less-technical users)

**Goal:** a user with a Linux box / NAS / Mac with Docker installed can go from nothing to
a working scanner in ~10 minutes without cloning the repo or editing YAML.

**7.3.1 Publish images (CI)** — _Complexity M_

- GitHub Actions on tag: build `linux/amd64` + `linux/arm64` (Raspberry Pi, Synology,
  Apple Silicon), push `ghcr.io/<owner>/spam-scanner:<semver>` and `:latest`.
- Compose references the published image; `build:` only in a dev override file.

**7.3.2 Distribution bundle** — _Complexity S_

- Release assets: `compose.yaml`, `rspamd/config/*`, `.env.example`, `install.sh`.
  Download via one `curl … | tar` line or a GitHub release zip.

**7.3.3 `install.sh` wizard** — _Complexity L_

1. Check prerequisites: Docker running, `docker compose` v2, architecture, free disk.
2. Ask install directory (default `~/spam-scanner`); create `data/` subdirs with correct
   ownership.
3. Ask IMAP host/port/user/password (hidden input); offer provider presets (Gmail,
   Fastmail, iCloud, Outlook, generic) that pre-fill host/port and print app-password
   instructions.
4. Test IMAP login immediately (`doctor --imap-only`); list folders; detect delimiter and
   Junk folder; propose folder names.
5. Choose mode: _Move to folders_ (recommended) or _Tag with keywords_; _Real-time
   (IDLE)_ (recommended) or _Every N minutes_.
6. Optional AI: provider (OpenAI / Ollama / none), key, privacy notice (5.19).
7. Generate a random rspamd password + hash (`bin/local/hash-rspamd-password.sh` already
   does the hashing half of this).
8. Write `.env` with `chmod 600`.
9. `docker compose up -d`; wait for healthchecks; run `doctor`; print a summary: folders
   created, how to train (with the ≥ 200 messages note, 5.20), how to view logs, how to
   open the rspamd UI safely, how to uninstall.

- Re-runnable: `install.sh --reconfigure`.
- Also provide a non-interactive mode (`--env-file`) for power users.

**7.3.4 `doctor` command** — _Complexity M_
Checks and prints ✅/❌ with a fix hint for each:

- config schema valid (5.10); secrets present
- IMAP connect/login/TLS; capabilities (IDLE, MOVE, keywords/PERMANENTFLAGS)
- delimiter/namespace; every configured folder resolves/exists
- rspamd reachable (`/ping`), password valid (authenticated `/stat`), Bayes learned counts
- Redis reachable (via rspamd stat)
- DNS resolver in use (5.6)
- AI endpoint reachable & model responds (if enabled)
- state message readable; `uid_validity` matches

**7.3.5 Day-2 helpers** — _Complexity S_

- `bin/update.sh` → `docker compose pull && docker compose up -d` (+ backup first).
- `bin/backup.sh` / `bin/restore.sh` (5.21).
- `bin/logs.sh` with friendly filters (errors only, last hour).
- `bin/uninstall.sh` (stops stack, optionally removes data and IMAP scanner folders).

**7.3.6 Developer path (separate from user path)** — _Complexity S_

- `npm run dev` (loads `.env` via Node's built-in `--env-file`, pretty logs),
  `npm run rspamd:up|down|logs` wrapping `bin/local/rspamd.sh`.

### 7.4 Documentation restructure proposal

`README.md` was already rewritten to match the current code; the split below is still
open.

| File                            | Audience   | Content                                                                                                    | Complexity |
| ------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------- | ---------- |
| `docs/INSTALL.md`               | users      | Installer walkthrough, manual Docker install, provider matrix (5.22), troubleshooting table                | M          |
| `docs/CONFIGURATION.md`         | users      | Generated table of every env var (name, default, description, example) from schema (5.10); modes explained | S          |
| `docs/USING.md`                 | users      | Training (spam/ham, how many), allow/block lists, removing entries, what labels/folders mean, AI net, FAQ  | S          |
| `docs/OPERATIONS.md`            | users      | Logs, health, backup/restore, upgrade, rspamd UI access via SSH tunnel, uninstall                          | S          |
| `docs/PRIVACY.md`               | users      | Data flows (IMAP → rspamd local; optional AI third party), logging of PII                                  | XS         |
| `docs/ARCHITECTURE.md`          | developers | Components (mermaid), scan cycle sequence, state model, processors, AI escalation rules, failure handling  | M          |
| `docs/DEVELOPMENT.md`           | developers | Local setup, tests (unit/integration/e2e), formatting/lint, openspec workflow, release process             | S          |
| `rspamd/config/README.md`       | both       | See 7.2.2                                                                                                  | S          |
| `CHANGELOG.md`                  | both       | Generated (6.21)                                                                                           | XS         |
| `CONTRIBUTING.md` / `AGENTS.md` | developers | Conventions, commit style, openspec as process (6.19)                                                      | XS         |

Doc hygiene: add a CI check that every env var read in `config.js` appears in
`CONFIGURATION.md` and `.env.example`.

---

## 7. Index of findings by area

| Area                             | Findings                                               |
| -------------------------------- | ------------------------------------------------------ |
| **REF** Refactoring & modularity | 5.10, 5.14, 5.28, 6.11                                 |
| **CLN** Clean-up / dead code     | 5.14, 6.6, 6.7                                         |
| **DOC** Documentation            | 5.19, 5.20, 5.21, 5.22, 7.4                            |
| **DEP** Build / deploy / install | 4.15, 5.7, 5.8, 5.22, 5.27, 5.29, 6.14, 7.3            |
| **MAP** Whitelist / blacklist    | 4.1, 5.2, 6.11, 7.1                                    |
| **RSP** Rspamd setup             | 4.1, 4.10, 5.6, 5.20, 7.2                              |
| **SEC** Security & privacy       | 4.1, 5.8, 5.18, 5.19                                   |
| **REL** Reliability              | 5.3, 5.7, 5.13, 6.5, 6.8, 6.9                          |
| **CFG** Configuration            | 5.10, 5.18, 5.28, 6.14, 6.16                           |
| **TST** Testing                  | 5.16, 5.29                                             |
| **TLG** Dependencies & tooling   | 5.17                                                   |
| **OPS** Operability              | 5.2, 5.7, 5.21, 5.23, 5.29, 6.21                       |
| **HYG** Repo hygiene             | 5.17, 6.18, 6.19                                       |
| **UX** End-user workflow         | 5.2, 5.3, 5.14, 5.20, 5.22, 5.27, 5.28, 6.6, 6.10, 7.1 |
| **LIC** Licensing & metadata     | 6.20, 6.21, 6.22                                       |

---

## 8. Suggested roadmap

Complexity totals are rough, for a single developer. Phase 0 ("stop the bleeding") is
fully complete — see the [Resolved log](#resolved-log).

### Phase 1 — Hardening & hygiene (remaining)

| Finding  | Item                                                     | Cx  |
| -------- | -------------------------------------------------------- | --- |
| 5.17     | GitHub Actions CI; one-time Prettier commit; Renovate    | S   |
| 4.1, 5.6 | Authenticated whitelist; wire unbound                    | S   |
| 5.10     | Config schema + validation                               | M   |
| 5.7, 5.8 | Compose de-dup; scanner heartbeat healthcheck; PUID/PGID | S   |
| —        | `CONTRIBUTING.md` documenting openspec as the process    | XS  |

### Phase 2 — Install experience & docs

| Finding                | Item                                                   | Cx  |
| ---------------------- | ------------------------------------------------------ | --- |
| 5.14                   | Unified CLI                                            | M   |
| 7.3.4                  | `doctor` + `status` commands                           | M   |
| 7.2                    | Commented rspamd config; `spam-scanner status`/`check` | S   |
| 7.3.1–7.3.2            | GHCR multi-arch images, release bundle                 | M   |
| 7.3.3, 7.3.5           | `install.sh` wizard + update/backup/restore scripts    | L   |
| 7.4                    | Documentation split (INSTALL/CONFIGURATION/USING/etc.) | M   |
| 5.19, 5.20, 5.21, 5.22 | Privacy, Bayes, backup, provider docs                  | S   |
| 5.27                   | `bin/setup-env.sh` `.env` bootstrap script             | S   |
| 5.29                   | Automated fresh-install end-to-end validation          | M   |

### Phase 3 — Structure & features (ongoing)

| Finding | Item                                                               | Cx  |
| ------- | ------------------------------------------------------------------ | --- |
| 5.16    | IMAP-facing test coverage gaps; e2e Compose test                   | L   |
| 7.1     | Lists v2: domain entries, removal folder/command                   | M   |
| 5.3     | Ham-trained keyword to prevent re-escalation                       | S   |
| 4.10    | Envelope/IP extraction for rspamd                                  | M   |
| 5.13    | Streaming/batched training fetch                                   | S   |
| 5.23    | Heartbeat, generalized notifier, digest                            | M   |
| 6.21    | Release automation & changelog                                     | S   |
| 5.22    | OAuth2 (Gmail / Microsoft)                                         | XL  |
| 5.28    | Multi-account-in-one-deployment (multi-instance already unblocked) | L   |

---

## Resolved log

One line per resolved finding — see `git log -p -- ROADMAP.md` for the full write-up that
used to live here (dates/commits/openspec changes for each).

| Finding | Outcome                                                                                   |
| ------- | ----------------------------------------------------------------------------------------- |
| 3.1     | Append-then-delete state writes; safe `UIDNEXT - 1` default when no state exists.         |
| 3.2     | Rspamd controller bound to loopback only; committed password hash removed.                |
| 4.2     | Folder paths resolved once at init against the server's real delimiter.                   |
| 4.3     | `FOLDER_SPAM` now always created by `runInit`.                                            |
| 4.4     | Per-message failure isolation (`Promise.allSettled`) for scan + training.                 |
| 4.5     | IDLE now handles `close`, has a watchdog, and does a pre-IDLE catch-up check.             |
| 4.6     | `RSPAMD_TIMEOUT_MS` added; all rspamd `fetch()` calls now time out.                       |
| 4.7     | Secrets redacted from all pino log output via the `redact` option.                        |
| 4.8     | Three stale/red unit tests fixed to match intended behavior.                              |
| 4.9     | Node 24 base image; `imapflow` bumped; `npm audit` clean of high-severity issues.         |
| 4.11    | README rewritten to match current code.                                                   |
| 4.12    | Defaults aligned across `config.js`/`.env.example`/README.                                |
| 4.13    | `bin/local/hash-rspamd-password.sh` links `RSPAMD_PASSWORD` to the controller hash.       |
| 4.14    | `SPAM_SCANNER_DATA` now required via Compose `:?` guard.                                  |
| 5.1     | Map-training messages always moved on, even with no extractable sender.                   |
| 5.4     | `UIDVALIDITY` tracked in scanner state; safe reset to `UIDNEXT - 1` on mismatch.          |
| 5.5     | `readScannerState` bug fixes (max UID, dead-code order); formatters unified.              |
| 5.9     | `LOG_FORMAT=pretty` no longer crashes in Docker; falls back to JSON with a warning.       |
| 5.11    | Classification thresholds now configurable env vars.                                      |
| 5.12    | Graceful `SIGTERM`/`SIGINT` shutdown.                                                     |
| 5.15    | `src/lib` relayered into `core/utils/services/clients/controllers`.                       |
| 5.24    | `bin/local/build.sh` deleted (won't-fix, moot).                                           |
| 5.25    | `docs/features` deleted; openspec specs synced and validated.                             |
| 5.26    | Compose container names/network are project-scoped; parallel stacks supported.            |
| 5.30    | Whitelist/blacklist matching moved into app code, IMAP-backed.                            |
| 6.1     | Dead SpamAssassin-era parsers removed.                                                    |
| 6.2     | Redundant `src/idle.js` deleted.                                                          |
| 6.3     | `ColorProcessor` stub removed.                                                            |
| 6.4     | Unused dependencies removed.                                                              |
| 6.12    | `.bin/` no longer exists (moot).                                                          |
| 6.13    | `bin/local/sort-maps.sh` deleted (maps no longer local files).                            |
| 6.15    | `check-eml.sh` usage text fixed.                                                          |
| 6.17    | `validateState` allows additive optional fields.                                          |
| 6.23    | `.github/` Copilot/openspec docs replaced by `CLAUDE.md`.                                 |
| 7.5     | Original target-module-structure deep dive — done; see `CLAUDE.md` for the actual layout. |
