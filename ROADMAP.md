# spam-scanner — Roadmap (Open Items)

- **Original review date:** 2026-09-17
- **Last cleanup:** 2026-09-24 — resolved findings deleted entirely rather than logged
  here; see `git log -p -- ROADMAP.md` for the full write-up of anything that used to be
  here and why it was resolved.

---

## How to read this document

Every finding has a **stable number** (`<section>.<item>`, e.g. `4.7`) so it can be
referenced in issues, commits and openspec changes. Numbers are not resequenced when items
are resolved and deleted — a gap in the sequence just means that finding was resolved; see
`git log -p -- ROADMAP.md` for its history.

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

---

## 1. Executive summary

The core design is sound: incremental UID scanning, state stored in the mailbox,
folder-based training that needs no UI, a clean escalate-only AI safety net with good
tests, and a pluggable processor strategy.

The main risks still open are concentrated in two places:

1. **First-time installation** — no published image or guided installer (4.15), and
   no per-provider setup guide (Gmail/Outlook/OAuth2, delimiters, Junk folder) (5.22).
2. **Maintainability & operability** — gaps in IMAP-facing test coverage and no
   end-to-end smoke test (5.16), and no heartbeat/health signal for monitoring (5.23).

**Top actions by value/effort**

| #   | Action                                                     | Findings  | Complexity |
| --- | ---------------------------------------------------------- | --------- | ---------- |
| 1   | `doctor` command (config/IMAP/rspamd connectivity checks)  | 7.3       | M          |
| 2   | Publish multi-arch image to GHCR + `install.sh` wizard     | 4.15, 7.3 | L          |
| 3   | Single `spam-scanner` CLI binary with subcommands          | 5.14      | M          |
| 4   | Fill IMAP-facing test coverage gaps; add an e2e smoke test | 5.16      | L          |
| 5   | Heartbeat file + generalized failure notifier              | 5.23      | M          |

---

## 2. Critical findings

None open.

---

## 3. High findings

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

### 5.2 Maps have no per-entry removal path or comments

- **Area:** MAP, UX, OPS · **Complexity:** M
- **Where:** `src/lib/services/sender-lists.service.js`; `src/admin/import-list.js`

**Problem.** Whitelist/blacklist are IMAP-backed and app-owned (mailbox is the real
source of truth) and support both exact addresses and `@example.com` domain entries, but:

- The only way to remove a mistaken entry is `src/admin/import-list.js --mode override`,
  which wholesale-replaces a list from a corrected file — there's no "remove just this one
  address" command.
- Entries can't carry comments (e.g. when/why an entry was added).

**Recommendation.** See **7.1** (a dedicated removal folder/command, comments).

### 5.3 Ham-trained messages can be re-escalated by AI (training loop)

- **Area:** UX, REL · **Complexity:** S
- **Where:** `src/lib/controllers/workflows/train.controller.js`;
  `src/lib/controllers/steps/ai-classification.step.js`

**Problem.** Messages in `train.ham` are learned as ham, then **moved back to INBOX**,
where they receive a new UID greater than `last_uid` and are scanned again. Bayes will
lower the rspamd score, but the AI net is independent of Bayes: if the AI still scores it ≥
threshold, the message is labelled/moved to `spam.low`/`spam.high` again. In `folder` mode
the user sees the message they just rescued disappear again. The same applies to
whitelist-trained messages if the sender isn't authenticated.

**Recommendation.** When training ham, tag the message with an IMAP keyword (e.g.
`$ScannerHam`) before moving it back; the scan workflow skips (or never escalates)
messages carrying it. Alternatively record their Message-IDs in state for N days.

**Attempted and reverted (2026-09-21):** implemented as a permanent `$ScannerTrained`
IMAP keyword exempting the tagged message from AI escalation forever, with no built-in way
to undo the exemption if a message was mistrained (e.g. spam accidentally dragged into
`train.ham`). Reverted after review over that lack of an undo path - see `git log` for
`f5f77d2`/`c50da2e`. A future attempt should design in a way to reverse a bad tag (a
CLI/admin command, or a time-bounded exemption instead of permanent) before tagging again.

### 5.7 No scanner-level healthcheck

- **Area:** DEP, OPS, REL · **Complexity:** XS
- **Where:** `docker-compose.yml`

**Problem.** Image pinning, healthchecks (rspamd/redis), `depends_on: condition:
service_healthy`, and compose file de-duplication (`docker-compose.base.yml` + `include:`,
shared by the production and dev compose files) are all in place. The spam-scanner service
itself still has no healthcheck — there's no heartbeat file yet for `docker ps` to check
against (blocked on 5.23).

**Recommendation.** Add a scanner-level healthcheck once 5.23's heartbeat file lands.

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
files, 435 tests, all green), with coverage tooling (`npm run test:coverage`) wired up.
Still open:

- CI (already in place: lint/format/test/docker-build) doesn't yet run `test:coverage` or
  gate a threshold on it.
- No end-to-end smoke test against a real IMAP server — `test/integration/` contains only
  a live-AI-provider test. A GreenMail/Dovecot + rspamd-in-Compose smoke test (create
  mailbox, drop fixtures, run one cycle, assert folders/labels/state) was never built.
- `src/cli/orchestrator.js` itself — the mode loop (single-run/poll/IDLE selection),
  `MAX_RETRIES` backoff, and `SIGTERM`/`SIGINT` handling — has no dedicated unit test; the
  pieces it calls are each tested in isolation, but the loop wiring them together isn't.
- `imap.client.js`'s coverage (55–71% depending on how it's sliced) is the largest
  untested surface left in `src/lib/`, pulled down by IDLE/reconnect branches.

**Recommendation.**

- Add a `test:coverage` step to the existing CI workflow and gate on a threshold.
- Add the GreenMail/Dovecot + rspamd Compose smoke test, run on demand or nightly (not on
  every push — it's slow).
- Add a focused unit test for `src/cli/orchestrator.js`'s loop/retry/shutdown logic,
  injecting fake workflow controllers via `ctx`.
- Fill in `imap.client.js`'s IDLE/reconnect branch coverage.

### 5.20 Rspamd Bayes cold start (`min_learns`) not explained to users

- **Area:** RSP, DOC, UX · **Complexity:** XS (docs) / S (status command)
- **Where:** `rspamd/config/classifier-bayes.conf`

**Problem.** Rspamd's Bayes classifier doesn't contribute until it has learned a minimum
number of spam **and** ham messages (default 200 each). New users who train 20 spams will
see no effect and conclude the tool doesn't work.

**Recommendation.** Make `min_learns` explicit in `classifier-bayes.conf` with a comment;
document "train ≥ 200 spam and ≥ 200 ham"; add a `spam-scanner status` command that shows
learned counts from `GET /stat` and map sizes.

### 5.22 Provider compatibility (Gmail, Outlook, OAuth2, keywords) undocumented (verify)

- **Area:** UX, DOC, DEP · **Complexity:** S (docs) / L (OAuth2)

**Problem.**

- Gmail requires an app password (with 2FA) or OAuth2; Microsoft consumer/365 accounts
  have largely disabled basic auth for IMAP → only OAuth2 works. `imapflow` supports
  `accessToken`, but the app has no OAuth flow.
- Folder delimiter/namespace differences and Junk folder naming across providers.
- `label` mode's keyword-visibility caveat is noted in `README.md`'s
  `SPAM_PROCESSING_MODE` comment, but not verified per provider.

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

- **Area:** CFG, UX, REF · **Complexity:** L
- **Where:** `src/lib/core/config.js` (single `IMAP_*`/`FOLDER_*`/`STATE_KEY_SCANNER`
  block, read once at import); `src/cli/orchestrator.js`; `docker-compose.yml` (single
  `spam-scanner` service)

**Problem.** The whole app models exactly one mailbox: one `IMAP_HOST`/`USER`/`PASSWORD`,
one set of `FOLDER_*`, one `STATE_KEY_SCANNER`, one `SPAM_SCANNER_DATA`, loaded once as a
module-level singleton. Anyone wanting to protect a second mailbox (a spouse's inbox, a
second domain, a shared support address) must run one full stack per mailbox — supported
and documented in `README.md` ("Running Multiple Isolated Stacks", via
`-p`/`COMPOSE_PROJECT_NAME`), but each stack carries its own rspamd/Redis/Bayes corpus.

**Recommendation.** Multi-account-in-one-process: extend the config schema to accept an
array of mailbox definitions (e.g. a `mailboxes.yaml` or `MAILBOXES=family,work` with
per-prefix env vars) and have the orchestrator fan out a cycle per mailbox, each with its
own IMAP connection and state key, optionally sharing rspamd/Bayes/maps. Extending the
existing config schema to an array of mailbox definitions is itself nontrivial — track it
as a Phase 3 feature, not a quick win.

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

Wire this as a nightly/on-demand GitHub Actions job alongside the existing CI workflow,
rather than on every push (a Compose-based e2e run is slow). It also doubles as living
documentation of "what a working install looks like."

---

## 5. Low findings

None open.

---

## 6. Deep dives

### 7.1 Whitelist / blacklist redesign proposal

**Today (as-built).** Whitelist/blacklist matching is app code; each list is stored as an
IMAP state message (mailbox is the source of truth) rather than a local map file, and
`@example.com`-style domain entries are supported — the biggest structural changes this
proposal originally called for are already done.

**Still open:**

| #     | Change                                                                                                                                                                    | Complexity |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 7.1.4 | **Extract one address, from `From:` only** (authenticated one when available). Drop `Reply-To`/`Sender` for blacklist.                                                    | XS         |
| 7.1.5 | **Removal folder** `scanner.train.unlist`: senders of messages dropped there are removed from both lists; message moved back to INBOX.                                    | S          |
| 7.1.6 | **Blacklist also trains Bayes as spam** (single user action does both).                                                                                                   | XS         |
| 7.1.7 | **Feedback**: tag processed messages with a keyword (`$ScannerWhitelisted`, `$ScannerNoSender`) and/or post a short weekly digest of list changes.                        | S          |
| 7.1.8 | **CLI**: `maps list / add / remove / export / import` for power users; comments allowed (`# added 2026-09-17 from msg <id>`).                                             | S          |
| 7.1.9 | **Simplify folder names**: `Scanner/Always allow`, `Scanner/Always block`, `Scanner/Not spam`, `Scanner/Is spam`, `Scanner/Remove from lists`. Helps non-technical users. | S          |

### 7.2 Rspamd configuration simplification proposal

Current `rspamd/config/` has several one-line or tiny files with no comments; the link to
`.env`, ports and data dirs lives only in Compose. (The controller-password linkage,
loopback-only port binding, and envelope data to `/checkv2` this proposal originally called
for are already done.)

| #     | Recommendation                                                                                                                                                                                                  | Complexity |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 7.2.1 | Add a header comment to each file: purpose, what may be changed, related env/compose settings.                                                                                                                  | XS         |
| 7.2.2 | Add `rspamd/config/README.md` explaining: `local.d` override model, which file does what, how to view effective config (`rspamadm configdump`), how to test a message (`check-eml`).                            | S          |
| 7.2.4 | `classifier-bayes.conf`: explicit `min_learns`, `autolearn = false` (training is user-driven), comment on Redis backend.                                                                                        | XS         |
| 7.2.5 | Explicit `actions.conf` (`reject`, `add_header`, `greylist` thresholds) so the scanner's low/high thresholds can be reasoned about next to them.                                                                | XS         |
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
6. Optional AI: provider (OpenAI / Ollama / none), key, privacy notice.
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

- config schema valid; secrets present
- IMAP connect/login/TLS; capabilities (IDLE, MOVE, keywords/PERMANENTFLAGS)
- delimiter/namespace; every configured folder resolves/exists
- rspamd reachable (`/ping`), password valid (authenticated `/stat`), Bayes learned counts
- Redis reachable (via rspamd stat)
- DNS resolver in use
- AI endpoint reachable & model responds (if enabled)
- state message readable; `uid_validity` matches

**7.3.5 Day-2 helpers** — _Complexity S_

- `bin/update.sh` → `docker compose pull && docker compose up -d` (+ backup first).
- `bin/backup.sh` / `bin/restore.sh`.
- `bin/logs.sh` with friendly filters (errors only, last hour).
- `bin/uninstall.sh` (stops stack, optionally removes data and IMAP scanner folders).

**7.3.6 Developer path (separate from user path)** — _Complexity S_

- `npm run dev` (loads `.env` via Node's built-in `--env-file`, pretty logs),
  `npm run rspamd:up|down|logs` wrapping `bin/local/rspamd.sh`.

### 7.4 Documentation restructure proposal

`README.md` was already rewritten to match the current code; the split below is still
open.

| File                      | Audience   | Content                                                                                                   | Complexity |
| ------------------------- | ---------- | --------------------------------------------------------------------------------------------------------- | ---------- |
| `docs/INSTALL.md`         | users      | Installer walkthrough, manual Docker install, provider matrix (5.22), troubleshooting table               | M          |
| `docs/CONFIGURATION.md`   | users      | Generated table of every env var (name, default, description, example) from schema; modes explained       | S          |
| `docs/USING.md`           | users      | Training (spam/ham, how many), allow/block lists, removing entries, what labels/folders mean, AI net, FAQ | S          |
| `docs/OPERATIONS.md`      | users      | Logs, health, backup/restore, upgrade, rspamd UI access via SSH tunnel, uninstall                         | S          |
| `docs/PRIVACY.md`         | users      | Data flows (IMAP → rspamd local; optional AI third party), logging of PII                                 | XS         |
| `docs/ARCHITECTURE.md`    | developers | Components (mermaid), scan cycle sequence, state model, processors, AI escalation rules, failure handling | M          |
| `docs/DEVELOPMENT.md`     | developers | Local setup, tests (unit/integration/e2e), formatting/lint, openspec workflow, release process            | S          |
| `rspamd/config/README.md` | both       | See 7.2.2                                                                                                 | S          |

Doc hygiene: once `CONFIGURATION.md` exists, generate it from `config.js`'s `configGroups`
and drift-check it the same way `.env.example` already is (`config.test.js`).

---

## 7. Index of findings by area

| Area                             | Findings                                    |
| -------------------------------- | ------------------------------------------- |
| **REF** Refactoring & modularity | 5.14, 5.28                                  |
| **CLN** Clean-up / dead code     | 5.14                                        |
| **DOC** Documentation            | 5.20, 5.22, 7.4                             |
| **DEP** Build / deploy / install | 4.15, 5.7, 5.8, 5.22, 5.27, 5.29, 7.3       |
| **MAP** Whitelist / blacklist    | 5.2, 7.1                                    |
| **RSP** Rspamd setup             | 5.20, 7.2                                   |
| **SEC** Security & privacy       | 5.8                                         |
| **REL** Reliability              | 5.3, 5.7                                    |
| **CFG** Configuration            | 5.28                                        |
| **TST** Testing                  | 5.16, 5.29                                  |
| **OPS** Operability              | 5.2, 5.7, 5.23, 5.29                        |
| **UX** End-user workflow         | 5.2, 5.3, 5.14, 5.20, 5.22, 5.27, 5.28, 7.1 |

---

## 8. Suggested roadmap

Complexity totals are rough, for a single developer. Phase 0 ("stop the bleeding") is
fully complete.

### Phase 1 — Hardening & hygiene (remaining)

| Finding  | Item                                     | Cx  |
| -------- | ---------------------------------------- | --- |
| 5.7, 5.8 | Scanner heartbeat healthcheck; PUID/PGID | S   |

### Phase 2 — Install experience & docs

| Finding      | Item                                                   | Cx  |
| ------------ | ------------------------------------------------------ | --- |
| 5.14         | Unified CLI                                            | M   |
| 7.3.4        | `doctor` + `status` commands                           | M   |
| 7.2          | Commented rspamd config; `spam-scanner status`/`check` | S   |
| 7.3.1–7.3.2  | GHCR multi-arch images, release bundle                 | M   |
| 7.3.3, 7.3.5 | `install.sh` wizard + update/backup/restore scripts    | L   |
| 7.4          | Documentation split (INSTALL/CONFIGURATION/USING/etc.) | M   |
| 5.20, 5.22   | Bayes cold-start and provider docs                     | S   |
| 5.27         | `bin/setup-env.sh` `.env` bootstrap script             | S   |
| 5.29         | Automated fresh-install end-to-end validation          | M   |

### Phase 3 — Structure & features (ongoing)

| Finding | Item                                                                                            | Cx  |
| ------- | ----------------------------------------------------------------------------------------------- | --- |
| 5.16    | IMAP-facing test coverage gaps; e2e Compose test                                                | L   |
| 7.1     | Lists v2: removal folder/command, blacklist trains Bayes                                        | M   |
| 5.3     | Ham-trained AI re-escalation loop (tagging attempt reverted - needs a design with an undo path) | S   |
| 5.23    | Heartbeat, generalized notifier, digest                                                         | M   |
| 5.22    | OAuth2 (Gmail / Microsoft)                                                                      | XL  |
| 5.28    | Multi-account-in-one-deployment (multi-instance already unblocked)                              | L   |
