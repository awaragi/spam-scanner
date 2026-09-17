# spam-scanner — Codebase Review & Recommendations

- **Date:** 2026-09-17
- **Commit reviewed:** `061a40b` (master, clean tree)
- **Scope:** entire repository — `src/`, `test/`, `rspamd/config/`, `bin/`, `.bin/`, Docker files, `README.md`, `.env.example`, `docs/`, `openspec/`, `.github/`, `package.json`
- **Type:** analysis only — no code was changed
- **Last progress update:** 2026-09-17 — see [Progress since this review](#progress-since-this-review)

---

## Progress since this review

6 of the findings below are resolved, via the `harden-scan-reliability-and-docs` OpenSpec change (archived as `openspec/changes/archive/2026-09-17-harden-scan-reliability-and-docs/`). Each resolved finding is marked **✅ Resolved** inline with commit references. Nothing else in this document has been re-verified against the current code — treat every other finding as still open.

| Finding | Item | Commit(s) |
| ------- | ---- | --------- |
| 3.1 | Append-then-delete state writes; safe `UIDNEXT - 1` default when no state exists; new `SCAN_INITIAL_STATE` setting (user-requested addition, not in the original finding) | `24993dc` |
| 4.2 | Folder paths resolved once at startup against the server's real delimiter (`src/lib/utils/folder-resolver.js`), used everywhere via `config.FOLDER_*` | `24993dc` |
| 4.4 | `Promise.allSettled` + transient/permanent error classification for both scan and training batches; a permanently-failing training message now moves to its destination folder unlearned instead of being stuck; training failures (including transient ones) never abort the orchestrator cycle or count toward `MAX_RETRIES`/`process.exit` — only scan retains that escalation, by explicit user decision | `24993dc`, follow-up same-day fixes (uncommitted at time of writing) |
| 4.8 | The three stale/red tests fixed to match current intended behavior | `24993dc` |
| 4.11 | README rewritten to match current code (folders, defaults, script paths, IDLE mode, `AI_*`/`SPAM_PROCESSING_MODE` settings, etc.) | `24993dc` |
| 4.12 | `.env.example` and README defaults aligned to `config.js`; `config.js`'s own defaults for `SPAM_PROCESSING_MODE` (now `folder`) and `AI_MODEL` (now no default, fail-fast when `AI_ENABLED=true`) were also changed, by user decision during implementation | `24993dc` |

Everything else — including the rest of section 3–6 (3.2, 4.1, 4.3, 4.5–4.10, 4.13–4.15, all of 5 and 6) and the deep dives in section 7 — is still open as originally written.

---

## How to read this document

Every finding has a **stable number** (`<section>.<item>`, e.g. `4.7`) so it can be referenced in issues, commits and openspec changes.

Findings are **grouped by severity** (sections 3–6). Each finding carries:

| Field          | Meaning                                                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Area**       | Review aspect (see legend below) — section 8 re-indexes all findings by area                                            |
| **Where**      | Files / lines                                                                                                           |
| **Complexity** | Estimated work to fix: **XS** < 1 h · **S** 1–4 h · **M** 0.5–2 days · **L** 3–5 days · **XL** > 1 week                  |
| **(verify)**   | Marked when the finding is inferred from reading code/config and should be confirmed against a live system before acting |

**Severity legend**

| Severity     | Meaning                                                                                                  |
| ------------ | -------------------------------------------------------------------------------------------------------- |
| **Critical** | Can silently mis-handle a large amount of mail or expose the system; fix before anyone else installs it   |
| **High**     | Real bug, security weakness, or a blocker for a first-time / less-technical installer                     |
| **Medium**   | Correctness edge cases, maintainability debt, missing guard-rails, significant doc gaps                   |
| **Low**      | Cleanup, style, polish, nice-to-have                                                                     |

**Area legend**

| Code | Area                                          |
| ---- | --------------------------------------------- |
| REF  | Refactoring & modularity                      |
| CLN  | Clean-up / dead code                          |
| DOC  | Documentation                                 |
| DEP  | Build, deployment & first-time installation   |
| MAP  | Whitelist / blacklist maps                    |
| RSP  | Rspamd setup                                  |
| SEC  | Security, secrets & privacy                   |
| REL  | Reliability & failure modes                   |
| CFG  | Configuration design                          |
| TST  | Testing                                       |
| TLG  | Dependencies & tooling                        |
| OPS  | Operability (health, logs, backup)            |
| HYG  | Repository hygiene                            |
| UX   | End-user workflow                             |
| LIC  | Licensing & project metadata                  |

---

## Table of Contents

1. [Executive summary](#1-executive-summary)
2. [Current-state snapshot](#2-current-state-snapshot)
3. [Critical findings](#3-critical-findings)
   - 3.1 State write deletes before appending — a failure triggers a full-inbox rescan
   - 3.2 Rspamd controller exposed on all interfaces with a committed, well-known password hash
4. [High findings](#4-high-findings)
   - 4.1 Whitelist trusts the spoofable `From:` header, scores −20 and bypasses AI
   - 4.2 Folder paths hard-code `.` as the hierarchy delimiter
   - 4.3 Spam destination folder (`FOLDER_SPAM`) is never created
   - 4.4 A single "poison" message blocks scanning forever and crash-loops the container
   - 4.5 IDLE mode can hang forever and misses mail/training activity
   - 4.6 No timeouts on rspamd HTTP calls
   - 4.7 Secrets are written to logs at `LOG_LEVEL=debug`
   - 4.8 Unit test suite is red on master (3 failures)
   - 4.9 Node.js 20 is end-of-life; `imapflow` pulls vulnerable `nodemailer`
   - 4.10 Rspamd receives no envelope data (IP / HELO / MAIL FROM) (verify)
   - 4.11 README is substantially out of date and contradicts the code
   - 4.12 Defaults disagree between code, `.env.example` and README
   - 4.13 `RSPAMD_PASSWORD` in `.env` is disconnected from the hash in `worker-controller.inc`
   - 4.14 Unset `SPAM_SCANNER_DATA` silently mounts volumes at filesystem root
   - 4.15 No pre-built image and no guided installer
5. [Medium findings](#5-medium-findings)
   - 5.1 Map-training messages with no extractable sender are stuck forever
   - 5.2 Maps are add-only; no removal path; IMAP backup copy is never restored
   - 5.3 Ham-trained messages can be re-escalated by AI (training loop)
   - 5.4 `UIDVALIDITY` is not tracked
   - 5.5 `readScannerState` picks an arbitrary state message and leaks mailbox selection
   - 5.6 Unbound resolver container is started but not used by rspamd (verify)
   - 5.7 Docker images unpinned (`:latest`), no healthchecks, no startup ordering
   - 5.8 Container runs as root; files written to host data dir are root-owned
   - 5.9 `LOG_FORMAT=pretty` crashes inside the Docker image (verify)
   - 5.10 No configuration validation; config read at import time
   - 5.11 Classification thresholds (30 % / 60 %) are hard-coded
   - 5.12 No graceful shutdown (SIGTERM)
   - 5.13 Training/map workflows load entire folders into memory
   - 5.14 Entry-point boilerplate ×12 → single CLI
   - 5.15 Module structure: global singletons, mixed responsibilities
   - 5.16 Test coverage gaps on IMAP-facing code
   - 5.17 No CI, no linter, Prettier not applied (41 files non-conformant)
   - 5.18 `IMAP_TLS` defaults to `false`
   - 5.19 AI privacy & data-handling not documented
   - 5.20 Rspamd Bayes cold start (`min_learns`) not explained to users
   - 5.21 Backup / restore / upgrade story is incomplete and partly wrong
   - 5.22 Provider compatibility (Gmail, Outlook, OAuth2, keywords) undocumented (verify)
   - 5.23 No operational visibility (health, heartbeat, summary)
   - 5.24 `build-deploy-linux.local.sh` calls `build.sh` with unsupported flags
   - 5.25 Two parallel process/documentation systems (`docs/features` vs `openspec`)
6. [Low findings](#6-low-findings)
   - 6.1 – 6.22 (clean-up, polish, metadata)
7. [Deep dives](#7-deep-dives)
   - 7.1 Whitelist / blacklist redesign proposal
   - 7.2 Rspamd configuration simplification proposal
   - 7.3 First-time installation proposal (less-technical users)
   - 7.4 Documentation restructure proposal
   - 7.5 Target module structure
8. [Index of findings by area](#8-index-of-findings-by-area)
9. [Suggested roadmap](#9-suggested-roadmap)
10. [Appendix — evidence](#10-appendix--evidence)

---

## 1. Executive summary

The core design is sound: incremental UID scanning, state stored in the mailbox, folder-based training that needs no UI, a clean escalate-only AI safety net with good tests, and a pluggable processor strategy. The AI-related code added recently (`ai-*` modules) is the best-structured and best-tested part of the codebase and is a good template for the rest.

The main risks are concentrated in four places:

1. **Data-safety & reliability of the scan loop** — state is written delete-then-append (3.1), a single bad message or a hung HTTP call stops everything (4.4, 4.6), and IDLE mode can hang or miss events (4.5).
2. **Security of the default deployment** — rspamd's controller is published on all interfaces with a password hash committed to git (3.2); secrets reach logs at debug level (4.7); the whitelist can be abused by spoofing (4.1).
3. **First-time installation** — the README no longer matches the code (4.11, 4.12), there are several silent foot-guns (4.13, 4.14, 4.3, 4.2), and there is no published image or installer (4.15). A less-technical user is very unlikely to succeed today without help.
4. **Maintainability** — no CI, a red test suite (4.8), unapplied formatting, EOL Node (4.9), duplicated boilerplate, and import-time singletons that make IMAP-facing code hard to test (5.14–5.17).

**Top 10 actions by value/effort**

| #  | Action                                                                              | Findings           | Complexity | Status |
| -- | ----------------------------------------------------------------------------------- | ------------------ | ---------- | ------ |
| 1  | Append new state before deleting old; read highest-UID state message                 | 3.1, 5.5           | S          | 3.1 ✅ done, 5.5 open |
| 2  | Bind rspamd ports to `127.0.0.1` (or unpublish), generate password per install      | 3.2, 4.13          | S          | open |
| 3  | Fix failing tests, add GitHub Actions CI (test + prettier)                           | 4.8, 5.17          | S          | 4.8 ✅ done, 5.17 open |
| 4  | Redact secrets in config log; `npm audit fix` / bump imapflow; Node 24 base image     | 4.7, 4.9           | S          | open |
| 5  | Timeouts on rspamd calls + per-message failure isolation                             | 4.4, 4.6           | M          | 4.4 ✅ done, 4.6 open |
| 6  | Resolve folder paths via server delimiter / special-use; create spam folder          | 4.2, 4.3           | M          | 4.2 ✅ done, 4.3 open |
| 7  | Require DKIM/DMARC pass for whitelist hits; lower whitelist weight                   | 4.1, 7.1           | S          | open |
| 8  | `doctor` command + config schema validation                                          | 5.10, 7.3          | M          | open |
| 9  | Rewrite README + split docs (install / configure / train / operate)                  | 4.11, 4.12, 7.4    | M          | 4.11 ✅ done, 4.12 ✅ done, 7.4 (split) open |
| 10 | Publish multi-arch image to GHCR + `install.sh` wizard                               | 4.15, 7.3          | L          | open |

---

## 2. Current-state snapshot

| Item                    | Observation                                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------------- |
| Source                  | ~3,250 lines JS (ESM) in `src/`, 43 files                                                            |
| Tests                   | 17 unit files, 213 tests — **210 pass / 3 fail**; 1 integration test (live AI)                       |
| Formatting              | Prettier configured; **41 files** fail `prettier --check`                                             |
| Linting                 | None                                                                                                |
| CI                      | None (`.github/` contains only Copilot/openspec prompt files)                                        |
| Runtime                 | Docker `node:20-alpine` (EOL since 2026-04-30); local dev on Node 24                                 |
| Dependencies            | `npm audit --omit=dev`: **3 high** (nodemailer via imapflow); 7 packages behind latest major/minor    |
| Services                | spam-scanner, rspamd (`:latest`), redis (`alpine`), unbound (`:latest`)                              |
| Run modes               | `SCAN_INTERVAL` −1 single-run, 0 IDLE, >0 poll                                                       |
| Processing modes        | `label` (IMAP keywords), `folder` (move), `color` (stub)                                             |
| Process artefacts       | `docs/features/*` (Feb 2026 design/plan docs) **and** `openspec/` (specs + changes)                  |

---

## 3. Critical findings

### 3.1 State write deletes before appending — a failure triggers a full-inbox rescan

- **Area:** REL · **Complexity:** S
- **Where:** `src/lib/state-manager.js:72-102` (`writeScannerState`), `:104-128` (`writeMapState`); `src/lib/workflows/scan-workflow.js:206-213`
- **Status:** ✅ **Resolved** (commit `24993dc`). `writeScannerState`/`writeMapState` now append the new state message first, then delete the old one(s) by the UID(s) captured before the append. No-state initialization now peeks `UIDNEXT - 1` when the target mailbox is non-empty (logged at `warn`) instead of assuming `0`; a new `SCAN_INITIAL_STATE` setting (`new`/`all`, user-requested) controls this for the very first run.

**Problem.** `writeScannerState` deletes the existing state message (`messageDelete`) and *then* appends the new one. If the append fails (connection drop, quota exceeded, server timeout, container stopped at that instant), the state folder is left empty. On the next cycle `runScan` calls `readScannerState(imap, defaultState)` which silently returns `last_uid: 0`, and the drain loop in `orchestrator.js:91-93` rescans **the entire inbox** batch after batch. Consequences: every historic message is re-labelled or — in `folder` mode — possibly moved to spam folders; with `AI_ENABLED=true`, every historic non-spam message is sent to the AI provider (cost + privacy). Nothing is logged at warn level when the default state is used.

**Recommendation.**
1. Append the new state first, then delete older state messages by UID (`uid < newUid`), so there is always at least one valid state message.
2. When no state exists **and** the inbox is non-empty, do not assume `last_uid: 0`. Instead initialise to the current `UIDNEXT - 1` (only scan new mail) and log a warning; offer an explicit `--from-date` / `uid-on-date` path for intentional back-scans.
3. Log at `warn` whenever a default state is used.
4. Apply the same append-then-delete pattern to `writeMapState`.

### 3.2 Rspamd controller exposed on all interfaces with a committed, well-known password hash

- **Area:** SEC, RSP · **Complexity:** S
- **Where:** `docker-compose.yml:25-28`, `bin/local/docker-compose.yml:15-17`, `rspamd/config/worker-controller.inc:1`, `bin/local/check-eml.sh:7`, `.env.example:54`

**Problem.**
- Ports `11334` (controller + web UI) and `11332` (proxy) are published as `"11334:11334"`, i.e. on `0.0.0.0` of the Docker host — reachable from the LAN, and from the internet if the host has a public IP or port forwarding.
- The controller password hash is committed to git. `.env.example` and `check-eml.sh` both use `mypassword`, strongly suggesting that is the plaintext for the committed hash. Every installation that follows the docs therefore shares the same credentials.
- With controller access anyone can learn spam/ham (poisoning Bayes), view history (subjects, senders), and change settings.
- The spam-scanner container reaches rspamd over the internal Docker network and does **not** need any published port.

**Recommendation.**
1. Remove the `ports:` entries from the production compose file, or bind them to loopback: `"127.0.0.1:11334:11334"`. Drop `11332` entirely (the proxy worker is not used).
2. Stop committing a real hash: ship `worker-controller.inc.example`, and have the installer generate a random password and its hash (see 4.13, 7.3).
3. Remove the hard-coded password from `check-eml.sh` (read `RSPAMD_PASSWORD`/`RSPAMD_URL` from env or `.env`).
4. If the currently committed hash is in use anywhere reachable, rotate it now.

---

## 4. High findings

### 4.1 Whitelist trusts the spoofable `From:` header, scores −20 and bypasses AI

- **Area:** MAP, SEC, RSP · **Complexity:** S (auth requirement) / M (full redesign, see 7.1)
- **Where:** `rspamd/config/multimap.conf:1-8`; `src/lib/utils/spam-classifier.js:32-37`; `src/lib/workflows/scan-workflow.js:120-141`

**Problem.** `whitelisted_email` matches the MIME `From` / envelope sender (`extract_from = "both"`) with no authentication requirement, and applies **−20**. The scanner additionally treats `WHITELIST_EMAIL` as "trusted": whitelisted mail skips all low/high bucketing and the AI safety net. Phishing that forges the `From:` of a whitelisted contact (bank, employer, family member) — the most common phishing pattern — therefore lands clean with no AI check. The blacklist has the mirror problem: a spam that forged a legitimate address gets that innocent address blacklisted at +20.

**Recommendation.**
1. Add `require_symbols = "DMARC_POLICY_ALLOW | R_DKIM_ALLOW";` (or equivalent) to the whitelist rule so it only fires for authenticated senders. (verify exact expression syntax against the rspamd version in use.)
2. Reduce the weight (e.g. −8) so a strongly spammy message can still reach `reject`.
3. Keep the AI bypass only for authenticated whitelist hits (the symbol will only exist when authenticated after step 1).
4. For blacklist extraction, prefer the authenticated `From` domain / `Return-Path` and don't add addresses from `Reply-To` (commonly a victim's or a free-mail address in scams). See 7.1.

### 4.2 Folder paths hard-code `.` as the hierarchy delimiter

- **Area:** CFG, UX, REL · **Complexity:** M
- **Where:** `src/lib/utils/config.js:20-31`; `src/lib/utils/mailboxes-utils.js:7-24`; `src/lib/clients/imap-client.js:48-71`
- **Status:** ✅ **Resolved** (commit `24993dc`). New `src/lib/utils/folder-resolver.js` resolves every `config.FOLDER_*` string once during `runInit`, in place, against the server's real delimiter (via the shared `splitFolderParts` helper extracted from `mailboxes-utils.js`). Every call site keeps reading `config.FOLDER_*` as before — no new accessor layer. `NAMESPACE` handling is explicitly still out of scope (tracked as a follow-up, not a new finding).

**Problem.** Defaults such as `INBOX.scanner.train.spam` assume a Courier/Dovecot-style `.` delimiter. `createAppFolders` splits on `.`, `/` or `\` and re-joins with the *server's* delimiter — so on a `/`-delimited server (Gmail, Outlook/Exchange, many Dovecot setups, Fastmail) it creates `INBOX/scanner/train/spam`. Every other operation (`open`, `messageMove`, `append`) uses the raw configured string `INBOX.scanner.train.spam`, which does not exist on that server → training, scanning and state all fail. (verify on a `/` server.) Splitting also breaks legitimate folder names containing a dot.

**Recommendation.** Resolve all configured folders once at startup into server paths:
- Accept a delimiter-neutral notation in config (e.g. `/`), translate using the server delimiter from `LIST`.
- Honour `NAMESPACE` (some servers require `INBOX.` prefix, others forbid it).
- Store the resolved paths in a runtime folder map used by all workflows.
- Include this in the `doctor` output (7.3).

### 4.3 Spam destination folder (`FOLDER_SPAM`) is never created

- **Area:** DEP, UX · **Complexity:** XS–S
- **Where:** `src/lib/workflows/init-workflow.js:14-25`; used by `scan-workflow.js:155`, `train-workflow.js:58`, `map-workflow.js:103`

**Problem.** `runInit` creates training and state folders (and low/high folders in `folder` mode) but not `FOLDER_SPAM` (default `INBOX.spam`). On a mailbox where it doesn't exist, the first `reject` verdict or spam-training run fails, the cycle fails, and after `MAX_RETRIES` the process exits. Most servers already have a Junk folder with a different name (`Junk`, `INBOX.Junk`, `[Gmail]/Spam`).

**Recommendation.** Default `FOLDER_SPAM` to the server's `\Junk` special-use folder (available from `imap.list()`), fall back to creating the configured one, and include it in `runInit`.

### 4.4 A single "poison" message blocks scanning forever and crash-loops the container

- **Area:** REL · **Complexity:** M
- **Where:** `src/lib/services/message-service.js:21-70`; `src/lib/workflows/scan-workflow.js:112-198`; `src/orchestrator.js:115-127`; `src/lib/services/training-service.js:39-42`
- **Status:** ✅ **Resolved** (commit `24993dc`, refined same-day). `processWithRspamd`/`trainSpam`/`trainHam` now use `Promise.allSettled` with `src/lib/utils/error-classifier.js`'s permanent-vs-transient split: a permanent per-message failure is skipped and logged at `warn` without failing the batch; `last_uid` still advances past a permanently-skipped scan message. Two refinements made after the initial commit (not yet committed at time of writing): a training message that permanently fails to learn is now moved to its destination folder unlearned instead of being left stuck in the training folder forever; and `runTraining` no longer rethrows on *any* failure (transient batch failures included) — training is best-effort and never aborts the orchestrator cycle or counts toward `MAX_RETRIES`/`process.exit`. Scanning deliberately keeps escalating on a transient failure (retry-with-backoff, then exit) as the one remaining systemic-health signal — a user decision, not an oversight. The training-folder-move recommendation (`scanner.train.failed`) was decided against in favor of moving messages on as-is.

**Problem.** `processWithRspamd` uses `Promise.all` and rethrows the first error. If one message is rejected by rspamd (e.g. exceeds `max_message` size, malformed MIME, HTTP 4xx) the whole batch fails, state is not advanced, and the next cycle retries the same batch. After `MAX_RETRIES` (5) the orchestrator calls `process.exit(1)`; Docker restarts it (`restart: unless-stopped`) and it fails again — indefinitely. All new mail stops being scanned and nobody is notified. Training has the same shape: one bad message in a training folder blocks all training.

**Recommendation.**
- Use `Promise.allSettled`; classify errors as *transient* (network, 5xx, timeout → retry the batch) vs *permanent for this message* (4xx, parse error → skip, log at `warn`, leave message untouched, advance state).
- For training folders, move un-learnable messages to a `scanner.train.failed` folder (or leave them and log once).
- Reuse the AI failure-alert mechanism to post an INBOX notice when scanning is stuck (see 5.23).

### 4.5 IDLE mode can hang forever and misses mail/training activity

- **Area:** REL, UX · **Complexity:** M
- **Where:** `src/lib/workflows/idle-workflow.js:17-58`; `src/orchestrator.js:100-104`

**Problem.**
1. **Silent disconnect → hang.** `runIdle` resolves on `exists` and rejects on `error`, but not on `close`. If the connection is dropped without an error event (NAT timeout, server restart, laptop sleep), the promise never settles and the scanner stops permanently while the container looks healthy.
2. **Race: mail arriving between scan and IDLE is missed.** The scan runs on one connection; IDLE later opens a *new* connection and waits for a *new* `EXISTS`. Messages that arrived in between are not processed until yet another message arrives (could be hours overnight).
3. **Training folders are not watched.** Only `FOLDER_INBOX` is IDLE-watched. A user who drags messages into `train.spam` / `train.whitelist` sees nothing happen until new inbox mail arrives.

**Recommendation.**
- Also listen for `close`; add a watchdog timeout (e.g. re-cycle every 10–25 min regardless) so the loop always progresses.
- Before entering IDLE, compare `mailbox.uidNext - 1` with `state.last_uid`; if higher, skip IDLE and scan immediately.
- Either poll the training folders with `STATUS` on each IDLE wake-up/timeout (cheap) or run a short periodic training check (e.g. every 5 min) alongside IDLE.
- Delete the stand-alone `src/idle.js` (see 6.2).

### 4.6 No timeouts on rspamd HTTP calls

- **Area:** REL · **Complexity:** XS
- **Where:** `src/lib/clients/rspamd-client.js:55, 87, 138`

**Problem.** Native `fetch` has no default timeout. If rspamd accepts the connection but stalls (Redis down, DNS lookups hanging — see 5.6), the scan cycle hangs indefinitely; in IDLE/poll modes the process never recovers.

**Recommendation.** `fetch(url, { signal: AbortSignal.timeout(config.RSPAMD_TIMEOUT_MS) })` with a sensible default (e.g. 30 s), classify timeout as transient (4.4).

### 4.7 Secrets are written to logs at `LOG_LEVEL=debug`

- **Area:** SEC · **Complexity:** XS
- **Where:** `src/lib/utils/config.js:62`; also `src/lib/clients/rspamd-client.js:67` (full rspamd result incl. message metadata)

**Problem.** `logger.debug(c, 'Loading configuration')` logs the full config object including `IMAP_PASSWORD`, `RSPAMD_PASSWORD` and `AI_API_KEY`. Users are told to use `debug` when troubleshooting — exactly when logs get pasted into issues or chats.

**Recommendation.** Use pino's `redact` option (`['IMAP_PASSWORD','RSPAMD_PASSWORD','AI_API_KEY', '*.pass', '*.apiKey']`) at the root logger, or log a sanitised copy. Add a unit test that asserts secrets never appear in serialized config logs.

### 4.8 Unit test suite is red on master (3 failures)

- **Area:** TST · **Complexity:** XS–S
- **Where:** `test/email-parser.test.js` (`parseRspamdOutput > should parse Rspamd response with spam action`), `test/rspamd-maps.test.js` (`should create a new map file with normalized emails`, `should preserve sort order`)
- **Status:** ✅ **Resolved** (commit `24993dc`). All three tests updated to assert current intended behavior. The suite is green (270 tests passing as of this update); CI (5.17) is still not set up, so nothing catches a future regression automatically.

**Problem.** Tests encode old behaviour: `add header` used to mean `isSpam` (now only `reject` does, and `isWhitelisted` was added), and maps used to be sorted (now insertion order is preserved). A red suite hides real regressions and there is no CI to catch it (5.17).

**Recommendation.** Decide intended behaviour (current code appears intentional), update the three tests, then add CI so this can't recur.

### 4.9 Node.js 20 is end-of-life; `imapflow` pulls vulnerable `nodemailer`

- **Area:** TLG, SEC · **Complexity:** S (Node + audit) / M (major bumps)
- **Where:** `Dockerfile:2,8`; `package.json`; `package-lock.json`

**Problem.**
- `node:20-alpine` reached EOL on 2026-04-30 — no more security patches. Local development already runs Node 24, so Docker and dev differ.
- `npm audit --omit=dev` reports **3 high** advisories in `nodemailer` pulled by `imapflow 1.2.9` (fixed by `npm audit fix` / newer imapflow). Mostly send-side issues not exercised here, but still flagged.
- Outdated: `imapflow` 1.2.9 → 1.7.8 (2.0.5 major), `pino` 8 → 10, `pino-pretty` 10 → 13, `yargs` 17 → 18, `vitest` 3 → 5, `env-cmd` 10 → 11.

**Recommendation.** Move Docker to `node:24-alpine` (current LTS), add `"engines": {"node": ">=24"}` and `.nvmrc`; `npm audit fix` / bump imapflow within 1.x now; schedule majors (pino, vitest, imapflow 2) separately with tests green. Add Dependabot/Renovate (5.17).

### 4.10 Rspamd receives no envelope data (IP / HELO / MAIL FROM) (verify)

- **Area:** RSP · **Complexity:** M
- **Where:** `src/lib/clients/rspamd-client.js:49-73`; `src/lib/utils/email-parser.js:10-44`

**Problem.** Messages are posted to `/checkv2` as raw bytes with no `IP`, `Helo`, `From`, `Rcpt` or `Hostname` headers. Rspamd therefore can't evaluate SPF properly, can't run IP-based RBL/DNSBL checks against the real sending relay, and DMARC evaluation is weakened — a large portion of rspamd's accuracy. It also reduces the value of 4.1's authentication requirement (DKIM still works; SPF does not). (verify by inspecting symbols in rspamd history for a scanned message: expect `R_SPF_NA`/missing IP-based symbols.)

**Recommendation.** Parse the first `Received:` header added by the mailbox provider's MX (configurable trusted hop count or trusted hostnames) to obtain the connecting IP and HELO; pass them as `IP` / `Helo` request headers, plus `From` (Return-Path) and `Rcpt` (IMAP user). Alternatively configure rspamd's `external_relay` module to extract it server-side. Add fixtures to tests.

### 4.11 README is substantially out of date and contradicts the code

- **Area:** DOC · **Complexity:** M (rewrite, see 7.4)
- **Where:** `README.md`
- **Status:** ✅ **Resolved** (commit `24993dc`). README rewritten; all items 4.11.a–4.11.q below addressed. Not re-verified line-by-line against the *current* code in this update — if the code has drifted since `24993dc`, re-check before trusting this row.

**Specific inaccuracies (each is a trap for a new user):**

| #      | README says                                                               | Reality                                                                                           |
| ------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 4.11.a | Whitelist −5.0, blacklist +8.0                                             | `multimap.conf`: −20 / +20                                                                        |
| 4.11.b | Folders `INBOX.scanner.train-spam` (hyphen), state `INBOX.scanner.state`  | Code defaults `INBOX.scanner.train.spam` (dot), state `scanner.state` (see 4.12)                   |
| 4.11.c | "All state stored inside the mailbox and mirrored to disk"                | No disk mirror of scanner state exists                                                            |
| 4.11.d | "No external database or file storage required"                          | Redis + host data dir (`SPAM_SCANNER_DATA`) are required                                           |
| 4.11.e | `cd rspamd && docker-compose up -d`                                       | No `rspamd/docker-compose.yml`; use `bin/local/rspamd.sh up`                                       |
| 4.11.f | `train-whitelist.js` / `train-blacklist.js` are "placeholder for future"  | Fully implemented                                                                                 |
| 4.11.g | `node src/read-state.js`, `src/write-state.js`                            | Moved to `src/admin/`                                                                             |
| 4.11.h | Backup via `docker-compose -f rspamd/docker-compose.yml exec rspamd …`    | File doesn't exist; data is a host bind-mount now                                                 |
| 4.11.i | `./bin/local/start.sh` defaults to `.env`                                 | Script **requires** the env-file argument                                                          |
| 4.11.j | `SCAN_BATCH_SIZE=10000` default                                           | Code default 200                                                                                  |
| 4.11.k | Modes: one-shot and loop                                                  | IDLE mode (`SCAN_INTERVAL=0`) undocumented                                                        |
| 4.11.l | —                                                                         | `SPAM_PROCESSING_MODE`, `FOLDER_SPAM_LOW/HIGH`, `MAX_RETRIES`, `LOG_FILTER_*`, all `AI_*` missing |
| 4.11.m | Empty heading "Setup (Legacy - for reference)"                            | Remove                                                                                            |
| 4.11.n | `git clone https://github.com/yourusername/...`                           | Placeholder URL                                                                                   |
| 4.11.o | `docker-compose` (v1 CLI)                                                 | Scripts use `docker compose` (v2)                                                                 |
| 4.11.p | "Gmail-style labels"                                                      | Uses IMAP keywords; Gmail labels are a different mechanism (see 5.22)                             |
| 4.11.q | `export $(grep -v '^#' .env \| xargs)`                                     | Breaks with inline comments / spaces present in `.env.example` (see 6.14)                         |

### 4.12 Defaults disagree between code, `.env.example` and README

- **Area:** CFG, DOC · **Complexity:** S
- **Where:** `src/lib/utils/config.js`, `.env.example`, `README.md`, `src/orchestrator.js:48`
- **Status:** ✅ **Resolved** (commit `24993dc`). `.env.example` and README aligned to `config.js`. Note the fix direction wasn't purely "match docs to code" for two settings — by user decision, `config.js`'s own defaults changed instead: `SPAM_PROCESSING_MODE` is now `folder` (was `label`), and `AI_MODEL` now has no default and fails fast at load time when `AI_ENABLED=true` and it's unset (was `gpt-4o-mini`). The underlying recommendation (a generated config schema, finding 5.10) is still open — this was a hand-alignment, not a generator.

| Setting                | `config.js`                | `.env.example`          | README                        |
| ---------------------- | -------------------------- | ----------------------- | ----------------------------- |
| `FOLDER_STATE`         | `scanner.state`            | `INBOX.scanner.state`   | `INBOX.scanner.state`         |
| `FOLDER_TRAIN_*`       | `INBOX.scanner.train.spam` | same                    | `INBOX.scanner.train-spam`    |
| `SCAN_INTERVAL`        | −1 (read in orchestrator)  | 300                     | −1                            |
| `SCAN_BATCH_SIZE`      | 200                        | 10000                   | 10000                         |
| `SPAM_PROCESSING_MODE` | `label`                    | `folder`                | not documented                |
| `AI_MODEL`             | `gpt-4o-mini`              | `gpt-5-nano`            | not documented                |
| `IMAP_TLS`             | `false` if unset           | `true`                  | "required"                    |

A user who deletes a line from `.env` gets a *different* behaviour than the documented default; `FOLDER_STATE` in particular silently creates a top-level folder and loses track of existing state.

**Recommendation.** Single source of truth: a config schema (5.10) that defines name, type, default, description; generate the `.env.example` and the docs table from it (or at least unit-test that they match).

### 4.13 `RSPAMD_PASSWORD` in `.env` is disconnected from the hash in `worker-controller.inc`

- **Area:** DEP, RSP, CFG · **Complexity:** S
- **Where:** `.env.example:54`, `rspamd/config/worker-controller.inc`, `docker-compose.yml:15-16`

**Problem.** The README tells users to "set `RSPAMD_PASSWORD`". Doing so without also regenerating the hash (`rspamadm pw`) and editing `worker-controller.inc` makes every learn call fail with 403 — training silently stops working (errors only in logs). Nothing documents the link.

**Recommendation.** Generate the hash from `.env` automatically: either at install time (7.3) or with a tiny rspamd entrypoint/`command:` that renders `worker-controller.inc` from an env var on container start. Add a `doctor` check that performs an authenticated no-op (e.g. `GET /stat`) and reports "password mismatch" clearly.

### 4.14 Unset `SPAM_SCANNER_DATA` silently mounts volumes at filesystem root

- **Area:** DEP · **Complexity:** XS
- **Where:** `docker-compose.yml:10,18-20,31`; `bin/local/docker-compose.yml`

**Problem.** If `SPAM_SCANNER_DATA` is missing from `.env`, Compose substitutes an empty string with only a warning, producing mounts like `/rspamd/maps` and `/redis` at the host root (or failing with permission errors). `.env.example` ships the placeholder `/absolute/path/to/.spam-scanner`, which is accepted as-is. Also note: `bin/local/rspamd.sh` falls back to `~/.spam-scanner` but Compose does not, so the two can diverge.

**Recommendation.** Use `${SPAM_SCANNER_DATA:?Set SPAM_SCANNER_DATA in .env to an absolute path}`; or default to a relative `./data` directory next to the compose file (simplest for novices, no absolute path needed); have the installer create it.

### 4.15 No pre-built image and no guided installer

- **Area:** DEP · **Complexity:** L
- **Where:** `Dockerfile`, `bin/local/build.sh`, `build-deploy-linux.local.sh` (untracked)

**Problem.** Installing today requires: cloning the repo, understanding Compose variable interpolation, creating a data directory with correct permissions, hashing an rspamd password by hand, discovering the server's folder delimiter and Junk folder name, building an image locally (amd64-only in `build.sh`), and reading logs to find out whether it worked. That's beyond a less-technical user.

**Recommendation.** See full proposal in **7.3**: publish multi-arch images to GHCR from CI, ship a standalone `compose.yaml` + `install.sh` wizard, add a `doctor` command, and document provider-specific steps.

---

## 5. Medium findings

### 5.1 Map-training messages with no extractable sender are stuck forever

- **Area:** MAP, REL, UX · **Complexity:** XS
- **Where:** `src/lib/workflows/map-workflow.js:36-42`

**Problem.** If none of the messages in a whitelist/blacklist training folder yields a "human-readable" address (e.g. all from `bounce+…@` or long tokenised senders filtered by `isHumanReadable`), the function returns **before** moving the messages. They stay in the training folder and are re-fetched every cycle, and the user gets no feedback. The same happens partially: messages whose sender was rejected are moved along with the others without any indication they were ignored.

**Recommendation.** Always move processed messages; for messages that contributed no address, move them to the destination anyway and log at `info` (or tag them with a keyword such as `scanner-no-sender`) so the user can see it.

### 5.2 Maps are add-only; no removal path; IMAP backup copy is never restored

- **Area:** MAP, UX, OPS · **Complexity:** M
- **Where:** `src/lib/utils/rspamd-maps.js`; `src/lib/workflows/map-workflow.js:48-63`; `src/lib/state-manager.js:104-128`; `bin/local/sort-maps.sh`

**Problem.**
- The only way to remove a mistaken whitelist/blacklist entry is to SSH to the host and edit a root-owned file (5.8) under `SPAM_SCANNER_DATA`.
- Entries are exact addresses only; no domain entries (`@example.com`), no comments.
- The map content is backed up into the IMAP state folder (`writeMapState`), but nothing ever reads it back — on a new host or after losing the data dir, maps are empty even though a copy sits in the mailbox.
- `bin/local/sort-maps.sh` targets `rspamd/maps/` in the repo, which is no longer where maps live.
- Map files are rewritten in place (`fs.writeFile`) while rspamd watches them; a partially-written file can be read. Use write-to-temp + `rename`.

**Recommendation.** See **7.1**.

### 5.3 Ham-trained messages can be re-escalated by AI (training loop)

- **Area:** UX, REL · **Complexity:** S
- **Where:** `src/lib/workflows/train-workflow.js:67-69`; `src/lib/workflows/scan-workflow.js`

**Problem.** Messages in `train.ham` are learned as ham, then **moved back to INBOX**, where they receive a new UID greater than `last_uid` and are scanned again. Bayes will lower the rspamd score, but the AI net is independent of Bayes: if the AI still scores it ≥ threshold, the message is labelled/moved to `spam.low`/`spam.high` again. In `folder` mode the user sees the message they just rescued disappear again. The same applies to whitelist-trained messages if the sender isn't authenticated after 4.1.

**Recommendation.** When training ham, tag the message with an IMAP keyword (e.g. `$ScannerHam`) before moving it back; the scan workflow skips (or never escalates) messages carrying it. Alternatively record their Message-IDs in state for N days.

### 5.4 `UIDVALIDITY` is not tracked

- **Area:** REL · **Complexity:** S
- **Where:** `src/lib/utils/state-utils.js:11-41`; `src/lib/workflows/scan-workflow.js:206-238`

**Problem.** IMAP UIDs are only meaningful together with the mailbox `UIDVALIDITY`. If the server rebuilds the index or the mailbox is migrated, UIDs restart; a stored `last_uid` of 50,000 would then skip all new mail until UIDs catch up — silently.

**Recommendation.** Store `uid_validity` in state; on mismatch, log a warning and reset to `UIDNEXT - 1` (don't rescan the full inbox, see 3.1). `validateState` must accept the new field (currently rejects unknown properties — relax to allow additive evolution, e.g. a `version` field).

### 5.5 `readScannerState` picks an arbitrary state message and leaks mailbox selection

- **Area:** REL, REF · **Complexity:** XS
- **Where:** `src/lib/state-manager.js:30-70`

**Problem.**
- Uses `results[0]` — the **lowest** UID. If there are ever two state messages (e.g. after implementing 3.1, or manual restore), it reads the oldest.
- Early `return defaultState` skips restoring the original mailbox (`originalPath`).
- `validateState(json)` is called before the `if (!json)` check, so that check is dead code and the error message is misleading.
- IMAP `HEADER` search is a substring match: `X-App-State: scanner` would also match any future key containing "scanner".
- `formatMapAsEmail` duplicates `formatStateAsEmail`; `criteria` duplicates `buildStateCriteria`.

**Recommendation.** Take the max UID; restore mailbox in a `finally`; parse→null-check→validate; post-filter results by exact header value; unify the two formatters into one `formatAppStateEmail(key, body)`.

### 5.6 Unbound resolver container is started but not used by rspamd (verify)

- **Area:** RSP · **Complexity:** XS
- **Where:** `docker-compose.yml:44-49`; `rspamd/config/options.inc`

**Problem.** `options.inc` only sets `control_socket`; there is no `dns { nameserver = [...] }` pointing to `unbound`. Rspamd therefore uses the container's `/etc/resolv.conf` (Docker's embedded DNS → host resolver, often a public resolver). Public resolvers are blocked by Spamhaus and other DNSBLs, which return "blocked" codes rather than real results — degrading accuracy and occasionally producing false positives. (verify via `rspamadm configdump options` inside the container.)

**Recommendation.** Add to `options.inc`: `dns { nameserver = ["unbound:53"]; }` (verify syntax for the rspamd version), or remove the unbound service if not wanted. Document why a local recursive resolver matters.

### 5.7 Docker images unpinned (`:latest`), no healthchecks, no startup ordering

- **Area:** DEP, OPS, REL · **Complexity:** S
- **Where:** `docker-compose.yml`, `bin/local/docker-compose.yml`

**Problem.** `rspamd/rspamd:latest`, `klutchell/unbound:latest`, `redis:alpine` float — a `docker compose pull` can bring a breaking rspamd major (config syntax, Bayes schema) without warning. `depends_on` has no `condition: service_healthy`, so the scanner can start before rspamd is ready and burn retries. No `healthcheck` on any service, so `docker ps` shows "Up" for a stuck scanner.

**Recommendation.** Pin versions (e.g. `rspamd/rspamd:3.x.y`, `redis:7.x-alpine` or `valkey/valkey:8-alpine`), add healthchecks (rspamd `/ping`, `redis-cli ping`, scanner heartbeat file — 5.23), use `depends_on.condition: service_healthy`. Document upgrade procedure (5.21). Also consider de-duplicating the two compose files via a base file + override (`compose.yaml` + `compose.dev.yaml`).

### 5.8 Container runs as root; files written to host data dir are root-owned

- **Area:** SEC, DEP · **Complexity:** S
- **Where:** `Dockerfile`; `docker-compose.yml:9-10`

**Problem.** The Node process runs as root. Map files it writes into `${SPAM_SCANNER_DATA}/rspamd/maps` become root-owned on the host, so the user can't edit them without `sudo` (relevant to 5.2). Rspamd (uid `_rspamd`) and Redis also need write access to their bind-mounted directories; `rspamd.sh init` creates them with the host user's ownership, which may not be writable by those uids (verify on Linux; Docker Desktop on macOS masks this). The design doc `docs/features/20260219-share-rspamd-host-storage-design.md` mentions ownership handling but no implementation exists.

**Recommendation.** `USER node` in the Dockerfile; allow `PUID/PGID` overrides; installer creates dirs with correct ownership (or rspamd/redis entrypoints `chown` their own dirs); document SELinux `:z`.

### 5.9 `LOG_FORMAT=pretty` crashes inside the Docker image (verify)

- **Area:** DEP, OPS · **Complexity:** XS
- **Where:** `src/lib/utils/logger.js:71-85`; `package.json` (`pino-pretty` is a devDependency); `Dockerfile:8` (`--only=production`)

**Problem.** The image installs production deps only, so `pino-pretty` is absent. The `try/catch` around the transport config can't catch the failure — the transport is resolved later inside `pino(options)` — so the process throws at start-up. The README explicitly suggests `pretty` for debugging Docker. (verify with `docker run -e LOG_FORMAT=pretty …`.)

**Recommendation.** Either move `pino-pretty` to dependencies (small) or detect availability via `import.meta.resolve`/dynamic import and fall back to JSON with a warning. Also `npm ci --only=production` is deprecated → `npm ci --omit=dev`.

### 5.10 No configuration validation; config read at import time

- **Area:** CFG, REF · **Complexity:** M
- **Where:** `src/lib/utils/config.js`; `src/orchestrator.js:12-20, 48`; `src/lib/clients/ai-client.js:8-13`

**Problem.**
- Only `IMAP_HOST`/`IMAP_USER` are checked (in the orchestrator only — admin/train scripts don't check). `IMAP_PASSWORD` missing → cryptic IMAP auth error.
- `parseInt` results aren't checked (`SCAN_INTERVAL=5m` → `NaN` → `setTimeout(NaN)` → tight loop).
- Invalid `SPAM_PROCESSING_MODE` only fails at first scan, after training ran.
- `AI_ENABLED=true` without `AI_API_KEY` against the default OpenAI URL isn't caught until failures accumulate.
- `SCAN_INTERVAL` is read from `process.env` in the orchestrator, bypassing config.
- `AI_ESCALATE_TO_LOW_THRESHOLD > AI_ESCALATE_TO_HIGH_THRESHOLD` isn't rejected.
- `config`, `logger`, and the OpenAI client are created at import time, which forces tests to mock modules and prevents running with alternative configs.

**Recommendation.** Introduce a declarative schema (hand-rolled table or `zod`/`envalid`) with type, default, allowed values, description, `secret: true`. Validate once at startup and exit with a readable list of all problems. Export a `loadConfig(env)` function; build clients from config via small factories. The same schema drives docs generation and redaction (4.7, 4.12).

### 5.11 Classification thresholds (30 % / 60 %) are hard-coded

- **Area:** CFG, RSP · **Complexity:** S
- **Where:** `src/lib/utils/spam-classifier.js:13-18`; call site `scan-workflow.js:117`

**Problem.** The rspamd score → low/high mapping uses `score / required_score * 100` with thresholds 30/60, not configurable. `required_score` is rspamd's *reject* threshold (15 by default), so "low" = score > 4.5, "high" = score ≥ 9. These are important tuning knobs users will ask about, and they interact with the ±20 map scores. The `highProbableThreshold = 100` branch is redundant (both branches push to high).

**Recommendation.** Expose `SPAM_LOW_THRESHOLD` / `SPAM_HIGH_THRESHOLD` (preferably as absolute rspamd scores — easier to reason about alongside the rspamd UI than percentages), validate them, document with a worked example, simplify the branch.

### 5.12 No graceful shutdown (SIGTERM)

- **Area:** REL, OPS · **Complexity:** S
- **Where:** `src/orchestrator.js`

**Problem.** `docker stop` sends SIGTERM; with no handler Node exits immediately (PID 1 via `exec`). A batch interrupted after messages were moved but before state was written causes re-processing; an interrupted training batch may be learned but not moved (re-learned next time — harmless due to "already learned"); an interrupted map write may truncate the map file (5.2).

**Recommendation.** Handle SIGTERM/SIGINT: set a `stopping` flag checked between batches/steps, break sleeps and IDLE, finish the current batch, log out, exit 0. Keep Docker's default 10 s grace or set `stop_grace_period`.

### 5.13 Training/map workflows load entire folders into memory

- **Area:** REL · **Complexity:** S
- **Where:** `src/lib/clients/imap-client.js:195-210` (`fetchAllMessages`); `train-workflow.js:29`; `map-workflow.js:36`

**Problem.** `fetchAllMessages` downloads full sources of every message in the folder before processing. A user bulk-dragging a few thousand old spams (a very natural first action to "train" the filter) can exhaust container memory, and a failure mid-way repeats the whole download.

**Recommendation.** Search UIDs, then fetch/train/move in `PROCESS_BATCH_SIZE` chunks (the scan workflow already does this). For map training only headers are needed — fetch `headers` instead of `source`.

### 5.14 Entry-point boilerplate ×12 → single CLI

- **Area:** REF, CLN, UX · **Complexity:** M
- **Where:** `src/*.js`, `src/admin/*.js`

**Problem.** Twelve scripts repeat `newClient → connect → run → logout`, with inconsistent error handling (some `process.exit(1)`, some unhandled rejection; `read-state.js:13` passes the error as a second argument pino ignores). None are exposed via `package.json` scripts or `bin`. In Docker, running an admin task requires knowing `docker compose exec spam-scanner node src/admin/…`. `read-email.js` requires editing hard-coded constants (6.6).

**Recommendation.** One CLI (`src/cli.js`, yargs is already a dependency) with subcommands: `run` (orchestrator), `scan`, `train spam|ham|whitelist|blacklist`, `init`, `doctor`, `state show|set|reset|delete|from-date`, `maps list|add|remove|restore`, `export-email --uid|--message-id`, `folders list`. Shared `withImap(fn)` helper for connect/logout/error handling. Add `"bin": {"spam-scanner": "src/cli.js"}` and a Docker usage line `docker compose exec spam-scanner spam-scanner doctor`.

### 5.15 Module structure: global singletons, mixed responsibilities

- **Area:** REF · **Complexity:** L
- **Where:** throughout `src/lib`

**Observations.**
- `scan-workflow.js` (290 lines) mixes orchestration with alert email templating and posting (`buildAiFailureAlertEmail`, `postAiFailureAlert`) → extract a `notification-service`.
- `email-parser.js` mixes generic MIME header parsing, SpamAssassin (dead), rspamd and AI response parsing → split per concern (`rspamd` parser belongs next to the rspamd client; AI parser next to the AI client).
- `rspamd-client.js`: `learnHam` and `learnSpam` are identical except the endpoint → one `learn(type, content)`; a shared `post(path, body)` helper.
- `training-service.js`: `trainSpam`/`trainHam` identical → one function.
- `map-service.js` is a thin pass-through over `rspamd-maps.js` (`updateMapFile` adds only a debug log).
- `base-processor.js`: abstract class with one method and a factory using dynamic imports "to avoid circular dependencies" that don't exist → a plain object map `{label, folder}` of functions is enough.
- `state-manager.js` lives at `lib/` root while everything else is layered.
- `imap-client.js` exports thin wrappers (`count(box)` returns `box.exists`) and a `processMessage` that also strips headers and parses — domain logic inside the client.
- The orchestrator opens a **new IMAP connection per step** (≥ 6 logins per cycle, plus one per drain iteration). Some providers rate-limit logins. One connection per cycle (with reconnect on failure) is simpler and faster.
- `runStep`'s `finally { await imap.logout() }` can throw after a failed `connect`, masking the original error.

**Recommendation.** See target structure in **7.5**. Do it incrementally, starting with items that also unlock testing (config factory, IMAP `withImap`, rspamd `post` helper).

### 5.16 Test coverage gaps on IMAP-facing code

- **Area:** TST · **Complexity:** M–L

| Module                                 | Unit tests |
| -------------------------------------- | ---------- |
| `state-manager.js`                     | **none**   |
| `clients/imap-client.js`               | **none**   |
| `workflows/train-workflow.js`          | **none**   |
| `workflows/map-workflow.js`            | **none**   |
| `workflows/init-workflow.js`           | **none**   |
| `services/training-service.js`         | **none**   |
| `services/message-service.js`          | **none**   |
| `processors/label-*`, `folder-*`       | **none** (only base factory) |
| `orchestrator.js` (mode loop, retries) | **none**   |
| `utils/config.js`                      | **none**   |
| AI modules, classifier, parsers, maps  | good       |

Critical logic (3.1, 4.4, 4.5, 5.1, 5.4) lives in the untested modules.

**Recommendation.**
- Add `@vitest/coverage-v8` and a coverage script; set a modest threshold and ratchet up.
- Build a small in-memory fake IMAP client (search/fetch/move/append/delete over arrays) for workflow tests.
- Add an end-to-end smoke test using a real Dovecot/GreenMail container + rspamd in Compose, run in CI nightly or on demand: create mailbox, drop fixtures, run one cycle, assert folders/labels/state.
- Keep the live AI integration test opt-in (current approach is right).

### 5.17 No CI, no linter, Prettier not applied (41 files non-conformant)

- **Area:** TLG, HYG · **Complexity:** S
- **Where:** `.github/`, `package.json`, `.prettierrc.json`

**Problem.** Formatting varies (2- vs 4-space indents, `{a}` vs `{ a }`, single vs double quotes). No ESLint to catch unused imports, unused variables (e.g. `runScan as runScan`, unused `Ham` params), floating promises. No automated test run — hence 4.8.

**Recommendation.** One-time `npm run format` commit (isolated, no logic changes); add ESLint (flat config, `eslint:recommended` + `n` plugin); GitHub Actions workflow: install → lint → format:check → test → docker build; Dependabot or Renovate for npm, Docker base images and Compose images.

### 5.18 `IMAP_TLS` defaults to `false`

- **Area:** SEC, CFG · **Complexity:** XS
- **Where:** `src/lib/utils/config.js:18`

**Problem.** `IMAP_TLS: process.env.IMAP_TLS === 'true'` — omitting the variable disables TLS while the port defaults to 993 (implicit TLS). Result: confusing connection failure, or plaintext credentials if the port is changed to 143 without STARTTLS enforcement.

**Recommendation.** Default to `true`; if false, require `IMAP_ALLOW_INSECURE=true` and log a warning; ensure STARTTLS is required on 143 (`doSTARTTLS: true` in imapflow).

### 5.19 AI privacy & data-handling not documented

- **Area:** SEC, DOC · **Complexity:** S
- **Where:** `src/lib/clients/ai-client.js`, `src/lib/services/ai-classification-service.js:40-49`, `.env.example`

**Problem.** When enabled, full plain-text bodies (up to ~24 k chars) plus From/To/Subject of every non-whitelisted, non-spam message are sent to a third party. Subjects, senders and AI reasoning are logged at `info`. Neither is mentioned in user docs. Prompt-injection from email bodies ("rate this 0") is mitigated by the escalate-only design — worth stating as a deliberate property.

**Recommendation.** Add a "Privacy" section: what is sent, to whom, retention depends on provider, recommend local models (Ollama) for sensitive mailboxes; move subject/from/reasoning logging to `debug` or add `LOG_REDACT_PII=true`; document the injection-resistance property.

### 5.20 Rspamd Bayes cold start (`min_learns`) not explained to users

- **Area:** RSP, DOC, UX · **Complexity:** XS (docs) / S (status command)
- **Where:** `rspamd/config/classifier-bayes.conf`

**Problem.** Rspamd's Bayes classifier doesn't contribute until it has learned a minimum number of spam **and** ham messages (default 200 each). New users who train 20 spams will see no effect and conclude the tool doesn't work.

**Recommendation.** Make `min_learns` explicit in `classifier-bayes.conf` with a comment; document "train ≥ 200 spam and ≥ 200 ham"; add a `spam-scanner status` command that shows learned counts from `GET /stat` and map sizes.

### 5.21 Backup / restore / upgrade story is incomplete and partly wrong

- **Area:** OPS, DOC · **Complexity:** S
- **Where:** `README.md` "Backup & Restore"

**Problem.** Documented commands target non-existent files (4.11.h). The real state is: `${SPAM_SCANNER_DATA}` (Redis Bayes DB, rspamd data, maps) + IMAP state folder + `.env` + any local rspamd config edits. Redis snapshot consistency isn't addressed. No upgrade procedure (image tags, rspamd major upgrades, Bayes schema).

**Recommendation.** Document: stop stack (or `redis-cli BGSAVE`) → `tar` the data dir + `.env`; restore = untar + up. Add `bin/backup.sh`/`restore.sh` (or CLI subcommands). Add "Upgrading" section tied to pinned versions (5.7).

### 5.22 Provider compatibility (Gmail, Outlook, OAuth2, keywords) undocumented (verify)

- **Area:** UX, DOC, DEP · **Complexity:** S (docs) / L (OAuth2)

**Problem.**
- Gmail requires an app password (with 2FA) or OAuth2; Microsoft consumer/365 accounts have largely disabled basic auth for IMAP → only OAuth2 works. `imapflow` supports `accessToken`, but the app has no OAuth flow.
- `label` mode sets IMAP keywords (`Spam:Low`). Gmail does not expose arbitrary keywords as labels (it uses `X-GM-LABELS`), and many clients (Apple Mail, Outlook, most mobile apps) don't display keywords at all; Thunderbird does. (verify per provider.) For most users `folder` mode is the only visible option.
- Folder delimiter/namespace differences (4.2) and Junk folder naming (4.3).

**Recommendation.** A provider matrix in docs (Dovecot/cPanel, Fastmail, Gmail, iCloud, Outlook/365, Proton Bridge): auth method, delimiter, Junk folder, whether keywords are visible, recommended `SPAM_PROCESSING_MODE`. Consider making `folder` the default. OAuth2 support as a later feature.

### 5.23 No operational visibility (health, heartbeat, summary)

- **Area:** OPS · **Complexity:** S–M

**Problem.** The only signals are JSON logs. There's no way for Docker, an uptime monitor, or the user to know the scanner is alive and processing. The AI-failure alert pattern exists but isn't used for other failures (rspamd down, IMAP auth failing, MAX_RETRIES exit, stuck batch).

**Recommendation.**
- Write a heartbeat file (`/tmp/heartbeat` with last successful cycle timestamp) → Docker `healthcheck`.
- Generalise `ai-failure-tracker` into a `failure-notifier` covering rspamd/IMAP/scan failures (INBOX notice, rate-limited).
- Optional: daily/weekly digest message ("scanned N, spam N, low N, high N, AI escalations N, Bayes learned N/N").
- Optional: `HEALTHCHECK_URL` ping (healthchecks.io-style) after each successful cycle.

### 5.24 `build-deploy-linux.local.sh` calls `build.sh` with unsupported flags

- **Area:** DEP · **Complexity:** S
- **Where:** `build-deploy-linux.local.sh:9-14` (untracked, gitignored via `*.local.sh`); `bin/local/build.sh:40-47`

**Problem.** It passes `--host`, `--remote-path`, `--cleanup`; `build.sh` only accepts `--platform`, `--tag`, `--output` and exits with "Unknown option". The deploy script is broken as-is (it's personal, but it shows the build/deploy path needs a supported equivalent). Also `docker compose down && up` causes avoidable downtime; `up -d --no-build` alone recreates changed services.

**Recommendation.** Replace the tar-over-ssh flow with the registry-based flow in 7.3 (`docker compose pull && docker compose up -d`). If keeping it, add a tracked `bin/deploy.sh --host … --path …` with the flags implemented.

### 5.25 Two parallel process/documentation systems (`docs/features` vs `openspec`)

- **Area:** HYG, DOC · **Complexity:** S
- **Where:** `docs/features/*` (Feb 2026), `openspec/`, `.github/prompts`, `.github/skills`, `.github/agents`

**Problem.** Design/plan docs from February live in `docs/features/`; later work uses openspec. Some openspec capabilities (e.g. AI spam escalation) exist only as an **unarchived** change (`openspec/changes/ai-spam-escalation`) whereas the later `ai-failure-notification` change is archived and synced — so `openspec/specs/` doesn't describe the AI escalation behaviour that is already shipped. `openspec/config.yaml` has no project `context`. Contributors (human or AI) have to guess which system is authoritative.

**Recommendation.** Archive/sync `ai-spam-escalation`; move `docs/features/*` to `docs/history/` (or convert the still-relevant decisions into openspec specs); fill `openspec/config.yaml` `context:`; state in `CONTRIBUTING.md` that openspec is the process.

---

## 6. Low findings

### 6.1 Dead code: SpamAssassin-era parsers
- **Area:** CLN · **Complexity:** XS · **Where:** `src/lib/utils/email-parser.js:51-62` (`extractDateFromRaw`), `:99-116` (`parseSpamAssassinOutput`)
- Not used by `src/`. Remove along with their tests.

### 6.2 Redundant `src/idle.js`
- **Area:** CLN · **Complexity:** XS
- Stand-alone IDLE loop that only waits and does nothing on wake-up; superseded by `SCAN_INTERVAL=0` in the orchestrator. Remove.

### 6.3 `ColorProcessor` stub advertised as a mode
- **Area:** CLN, CFG · **Complexity:** XS
- `SPAM_PROCESSING_MODE=color` is accepted and silently does nothing except a warning per batch. Remove from factory/docs until implemented (keep an openspec change if desired).

### 6.4 Unused dependencies
- **Area:** TLG · **Complexity:** XS
- `emailjs-mime-codec` and `@types/emailjs-mime-codec` are not imported anywhere. `env-cmd` is only used by `test:integration` → devDependency.

### 6.5 `stripSpamHeaders` scans the whole message, not just headers
- **Area:** REL · **Complexity:** XS · **Where:** `email-parser.js:10-44`
- Body lines beginning with `x-spam-` are also removed, altering content sent to rspamd/Bayes. Stop at the first blank line.

### 6.6 `admin/read-email.js` requires editing hard-coded constants
- **Area:** CLN, UX · **Complexity:** XS · **Where:** `src/admin/read-email.js:11-12`
- UID `2201` and a real third-party Message-ID are committed. Make them CLI args (part of 5.14); remove the Message-ID from history if considered sensitive.

### 6.7 Logger misuse in `admin/read-state.js`
- **Area:** CLN · **Complexity:** XS · **Where:** `src/admin/read-state.js:13`
- `logger.error('msg', err.message)` — pino drops the second arg. Use `logger.error({ error: err.message }, 'msg')`.

### 6.8 Buffer → UTF-8 string conversion may alter 8-bit messages (verify)
- **Area:** REL · **Complexity:** S · **Where:** `src/lib/clients/imap-client.js:122`
- `message.source.toString()` decodes as UTF-8; non-UTF-8 8-bit bodies (legacy Latin-1 mail) get replacement characters before being posted to rspamd, changing Bayes tokens and fuzzy hashes. Post the original `Buffer` to rspamd; only decode for header parsing.

### 6.9 `runStep` logout can mask the original error
- **Area:** REL · **Complexity:** XS · **Where:** `src/orchestrator.js:37-43`
- Wrap `logout()` in try/catch (as `idle.js` does). Obsolete if 5.15's single-connection model is adopted.

### 6.10 AI alert `To:` uses `IMAP_USER`
- **Area:** UX · **Complexity:** XS · **Where:** `scan-workflow.js:44`
- `IMAP_USER` is not always an email address (e.g. `pierre` on self-hosted Dovecot). Add `NOTIFY_ADDRESS` defaulting to `IMAP_USER` when it contains `@`.

### 6.11 `isHumanReadable` heuristics contain provider-specific constants
- **Area:** MAP, REF · **Complexity:** XS · **Where:** `src/lib/utils/email.js:45-51`
- `lnk01.com`, `cyberimpact.com` hard-coded. Move to a configurable list (or a small data file) and document.

### 6.12 `.bin/list-folders.sh` duplicates functionality and uses a fragile env export
- **Area:** HYG · **Complexity:** XS
- Two script dirs (`.bin/` hidden, `bin/`). Replace with `spam-scanner folders list` (5.14) and delete `.bin/`.

### 6.13 `bin/local/sort-maps.sh` points to the old map location
- **Area:** CLN, MAP · **Complexity:** XS
- Targets `rspamd/maps` in repo; maps now live in `${SPAM_SCANNER_DATA}/rspamd/maps`. Also conflicts with "preserve insertion order" in `rspamd-maps.js`. Replace with `maps` CLI (7.1) or fix the path.

### 6.14 `.env.example` inline comments break shell-based loaders
- **Area:** CFG, DEP · **Complexity:** XS · **Where:** `.env.example:106-107`; `bin/local/start.sh`; README `export $(… | xargs)`
- `AI_ESCALATE_TO_LOW_THRESHOLD=50   # nonSpam -> lowSpam`: Compose strips it, but `start.sh`'s loader keeps `50   # nonSpam -> lowSpam` as the value (works only because `parseInt` tolerates trailing text). Put comments on their own lines.

### 6.15 `check-eml.sh` usage text names a different script
- **Area:** CLN · **Complexity:** XS
- Usage says `check-rspamd.sh`; hard-coded URL/password (see 3.2).

### 6.16 `SCAN_BATCH_SIZE` vs `PROCESS_BATCH_SIZE` naming is confusing
- **Area:** CFG · **Complexity:** XS
- One limits UIDs per scan pass, the other messages per rspamd/IMAP batch. Rename (`SCAN_MAX_PER_CYCLE`, `BATCH_SIZE`) with backward-compatible aliases, or document clearly.

### 6.17 `validateState` rejects any additional properties
- **Area:** REF · **Complexity:** XS
- Makes schema evolution (5.4 `uid_validity`, a `version` field) a breaking change for existing mailboxes. Allow known optional fields.

### 6.18 `.gitignore` is a generic Node template (~150 lines)
- **Area:** HYG · **Complexity:** XS
- Trim to what applies; local AI-tool dirs (`.idea`, `.junie`, `.windsurf`, `.temp`) should be listed explicitly (`.windsurf` currently relies on a global ignore).

### 6.19 AI-assistant configuration sprawl
- **Area:** HYG · **Complexity:** XS
- `.github/` contains Copilot instructions, agents, prompts and openspec skills; locally there are `.junie`, `.windsurf`, `.idea`; Claude Code has no `CLAUDE.md`. Consider one canonical `AGENTS.md` (project conventions) referenced by each tool-specific file, and keep tool-generated folders out of the repo root where possible.

### 6.20 Package metadata incomplete
- **Area:** LIC · **Complexity:** XS · **Where:** `package.json`
- Missing `"private": true` (prevents accidental publish), `"license": "MIT"`, `description`, `repository`, `engines`, `bin`, `start` script. Version is frozen at `1.0.0`; images are only tagged `latest`.

### 6.21 No CHANGELOG / release process
- **Area:** LIC, OPS · **Complexity:** S
- Adopt Conventional Commits (already mostly used: `feat:`, `chore:`) with `release-please` or `changesets` to generate `CHANGELOG.md`, semver tags and matching image tags.

### 6.22 Third-party licence notes
- **Area:** LIC · **Complexity:** XS
- App deps are permissive (MIT/Apache-2.0) — compatible with the MIT licence. Docker images: rspamd Apache-2.0; Redis ≥ 7.4 is RSALv2/SSPL (Redis 8 adds AGPLv3). Fine for personal/self-hosted use, but mention it in docs and consider `valkey/valkey` (BSD) as a drop-in. Copyright year in `LICENSE` is 2025 — optionally `2025-2026`.

---

## 7. Deep dives

### 7.1 Whitelist / blacklist redesign proposal

**Today (as-built)**

```
User drags mail → train.whitelist / train.blacklist folder
  → scanner extracts up to 2 "human-readable" addresses from From / Reply-To / Return-Path / Sender
  → appends to whitelist.map / blacklist.map on host (add-only)
  → copies map content into an IMAP state message (never read back)
  → moves mail to INBOX (whitelist) or spam folder (blacklist)
rspamd multimap: From (MIME or SMTP) exact match → −20 / +20
scanner: WHITELIST_EMAIL symbol → skip buckets and AI
```

**Pain points:** spoofable (4.1), add-only (5.2), exact addresses only, no feedback when nothing was extracted (5.1), backup copy unused, root-owned files (5.8), two copies of truth (file + IMAP), `Reply-To` extraction can list innocents, hard to explain to users.

**Proposed model — keep the folder UX, make it safe and reversible**

| #      | Change                                                                                                                                                                                                                                               | Complexity |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 7.1.1  | **Mailbox is the source of truth.** Store each list as an IMAP state message (already done). On startup and after every change, *render* the rspamd map files from it (atomic temp+rename). Fresh install / new host = lists restored automatically. | M          |
| 7.1.2  | **Authenticated whitelist.** `require_symbols` DKIM/DMARC pass (4.1); weight −8.                                                                                                                                                                      | S          |
| 7.1.3  | **Domain entries.** Two extra multimap rules (`filter = "email:domain"`) + map files; list syntax `@example.com` stored in the same list message.                                                                                                     | S          |
| 7.1.4  | **Extract one address, from `From:` only** (authenticated one when available). Drop `Reply-To`/`Sender` for blacklist.                                                                                                                                | XS         |
| 7.1.5  | **Removal folder** `scanner.train.unlist`: senders of messages dropped there are removed from both lists; message moved back to INBOX.                                                                                                                | S          |
| 7.1.6  | **Blacklist also trains Bayes as spam** (single user action does both).                                                                                                                                                                               | XS         |
| 7.1.7  | **Feedback**: tag processed messages with a keyword (`$ScannerWhitelisted`, `$ScannerNoSender`) and/or post a short weekly digest of list changes.                                                                                                    | S          |
| 7.1.8  | **CLI**: `maps list|add|remove|export|import` for power users; comments allowed (`# added 2026-09-17 from msg <id>`).                                                                                                                                   | S          |
| 7.1.9  | **Simplify folder names**: `Scanner/Always allow`, `Scanner/Always block`, `Scanner/Not spam`, `Scanner/Is spam`, `Scanner/Remove from lists` (resolved per server delimiter — 4.2). Human-readable names help non-technical users most.             | S          |

### 7.2 Rspamd configuration simplification proposal

Current `rspamd/config/` has five one-line or tiny files with no comments; the link to `.env`, ports and data dirs lives only in Compose.

| #     | Recommendation                                                                                                                                                                                                                  | Complexity |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 7.2.1 | Add a header comment to each file: purpose, what may be changed, related env/compose settings.                                                                                                                                  | XS         |
| 7.2.2 | Add `rspamd/config/README.md` explaining: `local.d` override model, which file does what, how to view effective config (`rspamadm configdump`), how to test a message (`check-eml`).                                             | S          |
| 7.2.3 | `worker-controller.inc` generated from `RSPAMD_PASSWORD` (4.13); ship `.example` only (3.2).                                                                                                                                     | S          |
| 7.2.4 | `options.inc`: `dns { nameserver = ["unbound:53"]; }` (5.6).                                                                                                                                                                     | XS         |
| 7.2.5 | `classifier-bayes.conf`: explicit `min_learns`, `autolearn = false` (training is user-driven), comment on Redis backend.                                                                                                         | XS         |
| 7.2.6 | Explicit `actions.conf` (`reject`, `add_header`, `greylist` thresholds) so the scanner's low/high thresholds (5.11) can be reasoned about next to them.                                                                          | XS         |
| 7.2.7 | Unpublish proxy port 11332; controller on `127.0.0.1` only (3.2). Access web UI via SSH tunnel doc snippet or opt-in `compose.override.yaml`.                                                                                    | XS         |
| 7.2.8 | Pin rspamd version; document upgrade (5.7, 5.21).                                                                                                                                                                                | XS         |
| 7.2.9 | Pass envelope data (4.10) or configure `external_relay`.                                                                                                                                                                         | M          |
| 7.2.10| Provide `spam-scanner status` using `/stat` (Bayes counts, uptime, scanned) and `spam-scanner check <file.eml>` replacing `check-eml.sh`.                                                                                        | S          |
| 7.2.11| Consider mounting individual config files instead of the whole `local.d` directory so image-provided `local.d` defaults (if any) aren't hidden. (verify contents of `/etc/rspamd/local.d` in the pinned image.)                  | XS         |

### 7.3 First-time installation proposal (less-technical users)

**Goal:** a user with a Linux box / NAS / Mac with Docker installed can go from nothing to a working scanner in ~10 minutes without cloning the repo or editing YAML.

**7.3.1 Publish images (CI)** — *Complexity M*
- GitHub Actions on tag: build `linux/amd64` + `linux/arm64` (Raspberry Pi, Synology, Apple Silicon), push `ghcr.io/<owner>/spam-scanner:<semver>` and `:latest`.
- Compose references the published image; `build:` only in a dev override file.

**7.3.2 Distribution bundle** — *Complexity S*
- Release assets: `compose.yaml`, `rspamd/config/*`, `.env.example`, `install.sh`. Download via one `curl … | tar` line or a GitHub release zip.

**7.3.3 `install.sh` wizard** — *Complexity L*
1. Check prerequisites: Docker running, `docker compose` v2, architecture, free disk.
2. Ask install directory (default `~/spam-scanner`); create `data/` subdirs with correct ownership (5.8).
3. Ask IMAP host/port/user/password (hidden input); offer provider presets (Gmail, Fastmail, iCloud, Outlook, generic) that pre-fill host/port and print app-password instructions.
4. Test IMAP login immediately (run `docker run --rm ghcr.io/…/spam-scanner doctor --imap-only`); list folders; detect delimiter and Junk folder; propose folder names (4.2, 4.3).
5. Choose mode: *Move to folders* (recommended) or *Tag with keywords*; *Real-time (IDLE)* (recommended) or *Every N minutes*.
6. Optional AI: provider (OpenAI / Ollama / none), key, privacy notice (5.19).
7. Generate random rspamd password + hash via `docker run --rm rspamd/rspamd:<pinned> rspamadm pw -p <pw>`; write `worker-controller.inc` (3.2, 4.13).
8. Write `.env` with `chmod 600`.
9. `docker compose up -d`; wait for healthchecks; run `doctor`; print a summary: folders created, how to train (with the ≥ 200 messages note, 5.20), how to view logs, how to open the rspamd UI safely, how to uninstall.
- Re-runnable: `install.sh --reconfigure`.
- Also provide a non-interactive mode (`--env-file`) for power users.

**7.3.4 `doctor` command** — *Complexity M*
Checks and prints ✅/❌ with a fix hint for each:
- config schema valid (5.10); secrets present
- IMAP connect/login/TLS; capabilities (IDLE, MOVE, keywords/PERMANENTFLAGS)
- delimiter/namespace; every configured folder resolves/exists (4.2, 4.3)
- rspamd reachable (`/ping`), password valid (authenticated `/stat`), Bayes learned counts
- Redis reachable (via rspamd stat)
- DNS resolver in use (5.6)
- map directory writable, map files readable
- AI endpoint reachable & model responds (if enabled)
- state message readable; `uid_validity` matches (5.4)

**7.3.5 Day-2 helpers** — *Complexity S*
- `bin/update.sh` → `docker compose pull && docker compose up -d` (+ backup first).
- `bin/backup.sh` / `bin/restore.sh` (5.21).
- `bin/logs.sh` with friendly filters (errors only, last hour).
- `bin/uninstall.sh` (stops stack, optionally removes data and IMAP scanner folders).

**7.3.6 Developer path (separate from user path)** — *Complexity S*
- `npm run dev` (loads `.env` via Node's built-in `--env-file`, pretty logs), `npm run rspamd:up|down|logs` wrapping `bin/local/rspamd.sh`; `start.sh` no longer needed (Node ≥ 20.6 supports `--env-file`).

### 7.4 Documentation restructure proposal

| File                          | Audience   | Content                                                                                                     | Complexity |
| ----------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------- | ---------- |
| `README.md`                   | everyone   | What it does (diagram), features, screenshots of folders, 5-step Quick Start (installer), links             | S          |
| `docs/INSTALL.md`             | users      | Installer walkthrough, manual Docker install, provider matrix (5.22), troubleshooting table                  | M          |
| `docs/CONFIGURATION.md`       | users      | Generated table of every env var (name, default, description, example) from schema (5.10); modes explained  | S          |
| `docs/USING.md`               | users      | Training (spam/ham, how many), allow/block lists, removing entries, what labels/folders mean, AI net, FAQ    | S          |
| `docs/OPERATIONS.md`          | users      | Logs, health, backup/restore, upgrade, rspamd UI access via SSH tunnel, uninstall                            | S          |
| `docs/PRIVACY.md`             | users      | Data flows (IMAP → rspamd local; optional AI third party), logging of PII                                   | XS         |
| `docs/ARCHITECTURE.md`        | developers | Components (mermaid), scan cycle sequence, state model, processors, AI escalation rules, failure handling   | M          |
| `docs/DEVELOPMENT.md`         | developers | Local setup, tests (unit/integration/e2e), formatting/lint, openspec workflow, release process               | S          |
| `rspamd/config/README.md`     | both       | See 7.2.2                                                                                                    | S          |
| `CHANGELOG.md`                | both       | Generated (6.21)                                                                                             | XS         |
| `CONTRIBUTING.md` / `AGENTS.md` | developers | Conventions, commit style, openspec as process (5.25, 6.19)                                               | XS         |
| `docs/history/`               | archive    | Former `docs/features/*`                                                                                     | XS         |

Doc hygiene: add a CI check that every env var read in `config.js` appears in `CONFIGURATION.md` and `.env.example` (4.12).

### 7.5 Target module structure

Incremental target (names indicative):

```
src/
  cli.js                     # yargs entry: run | scan | train | init | doctor | state | maps | folders | status | check
  app/
    orchestrator.js          # cycle loop, modes (once/poll/idle) as small strategy objects, SIGTERM handling
    cycle.js                 # one cycle: training steps → scan drain
  config/
    schema.js                # declarative definition (type, default, secret, description)
    load-config.js           # loadConfig(env) → validated, frozen object
  imap/
    connection.js            # newClient(config), withImap(fn), reconnect
    folders.js               # delimiter/namespace/special-use resolution, createAppFolders
    messages.js              # search/fetch (streaming, batched)/move/append/flags
    state-store.js           # app-state messages (scanner state, lists) – append-then-delete
  rspamd/
    client.js                # post(path, body, {timeout}), check(), learn(type)
    parse-result.js          # parseRspamdOutput
    envelope.js              # IP/HELO extraction from Received (4.10)
    maps.js                  # render/atomic write of map files
  ai/
    client.js, prompt.js, parse-output.js, classification-service.js, error-reason.js
  domain/                    # pure, fully unit-tested, no I/O
    classify.js              # rspamd buckets + AI escalation
    senders.js               # sender extraction / human-readable heuristics
    state.js                 # validation, migration (versioned)
    lists.js                 # allow/block list model (add/remove/domain entries)
  workflows/
    scan.js, train.js, lists.js, init.js, idle.js
  processing/
    label.js, folder.js      # plain functions selected by mode
  notify/
    notifier.js              # generalized failure/digest notices (from scan-workflow + ai-failure-tracker)
  logging/
    logger.js                # with redact
```

Guiding rules: pure logic in `domain/` (no imports of config/logger singletons); I/O adapters receive config via factory arguments; workflows compose adapters + domain and are tested with an in-memory IMAP fake (5.16).

---

## 8. Index of findings by area

| Area | Findings |
| ---- | -------- |
| **REF** Refactoring & modularity | 5.5, 5.10, 5.14, 5.15, 6.11, 6.17, 7.5 |
| **CLN** Clean-up / dead code | 5.14, 6.1, 6.2, 6.3, 6.6, 6.7, 6.13, 6.15 |
| **DOC** Documentation | 4.11, 4.12, 5.19, 5.20, 5.21, 5.22, 5.25, 7.4 |
| **DEP** Build / deploy / install | 4.3, 4.13, 4.14, 4.15, 5.7, 5.8, 5.9, 5.22, 5.24, 6.14, 7.3 |
| **MAP** Whitelist / blacklist | 4.1, 5.1, 5.2, 6.11, 6.13, 7.1 |
| **RSP** Rspamd setup | 3.2, 4.1, 4.10, 4.13, 5.6, 5.11, 5.20, 7.2 |
| **SEC** Security & privacy | 3.2, 4.1, 4.7, 4.9, 5.8, 5.18, 5.19 |
| **REL** Reliability | 3.1, 4.2, 4.4, 4.5, 4.6, 5.1, 5.3, 5.4, 5.5, 5.7, 5.12, 5.13, 6.5, 6.8, 6.9 |
| **CFG** Configuration | 4.2, 4.12, 4.13, 5.10, 5.11, 5.18, 6.3, 6.14, 6.16 |
| **TST** Testing | 4.8, 5.16 |
| **TLG** Dependencies & tooling | 4.9, 5.17, 6.4 |
| **OPS** Operability | 5.2, 5.7, 5.9, 5.12, 5.21, 5.23, 6.21 |
| **HYG** Repo hygiene | 5.17, 5.25, 6.12, 6.18, 6.19 |
| **UX** End-user workflow | 4.2, 4.3, 4.5, 5.1, 5.2, 5.3, 5.14, 5.20, 5.22, 6.6, 6.10, 7.1.9 |
| **LIC** Licensing & metadata | 6.20, 6.21, 6.22 |

---

## 9. Suggested roadmap

Complexity totals are rough, for a single developer.

### Phase 0 — Stop the bleeding (≈ 1–2 days)

| Finding | Item                                                         | Cx  | Status |
| ------- | ------------------------------------------------------------ | --- | ------ |
| 3.1     | Append-then-delete state; safe default when state missing    | S   | ✅ done (`24993dc`) |
| 5.5     | Read highest-UID state; restore mailbox                      | XS  | open |
| 3.2     | Loopback-bind/unpublish rspamd ports; rotate password        | S   | open |
| 4.7     | Redact secrets in logs                                       | XS  | open |
| 4.8     | Fix 3 failing tests                                          | XS  | ✅ done (`24993dc`) |
| 4.6     | Rspamd fetch timeouts                                        | XS  | open |
| 4.14    | `${SPAM_SCANNER_DATA:?}` guard                               | XS  | open |
| 4.3     | Create/resolve spam folder in init                           | XS  | open |
| 5.1     | Move map-training messages even when no sender extracted     | XS  | open |
| 4.9     | `npm audit fix`; Docker `node:24-alpine`; `--omit=dev`       | S   | open |
| 5.18    | `IMAP_TLS` default true                                      | XS  | open |

### Phase 1 — Hardening & hygiene (≈ 1–1.5 weeks)

| Finding          | Item                                                     | Cx | Status |
| ---------------- | -------------------------------------------------------- | -- | ------ |
| 5.17             | Prettier commit, ESLint, GitHub Actions CI, Renovate     | S  | open |
| 4.4              | Per-message failure isolation (scan + training)          | M  | ✅ done (`24993dc`, refined same-day) |
| 4.5              | IDLE close/watchdog, pre-IDLE catch-up, training polling | M  | open |
| 5.12             | Graceful shutdown                                        | S  | open |
| 5.10, 4.12       | Config schema + validation; align all defaults           | M  | 4.12 ✅ done (`24993dc`, hand-aligned, not schema-generated), 5.10 open |
| 4.2              | Delimiter/namespace/special-use folder resolution        | M  | delimiter ✅ done (`24993dc`), namespace/special-use still open |
| 5.4, 6.17        | UIDVALIDITY in versioned state                           | S  | open |
| 5.7, 5.8, 5.9    | Pin images, healthchecks, non-root, pretty-log fallback  | S  | open |
| 4.1, 5.6         | Authenticated whitelist; wire unbound                    | S  | open |
| 6.1–6.4, 6.12–6.15 | Dead code & script clean-up                            | S  | open |
| 5.25             | Archive/sync openspec change; move `docs/features`        | S  | open |

### Phase 2 — Install experience & docs (≈ 2 weeks)

| Finding       | Item                                                  | Cx | Status |
| ------------- | ----------------------------------------------------- | -- | ------ |
| 5.14          | Unified CLI                                            | M  | open |
| 7.3.4         | `doctor` + `status` commands                           | M  | open |
| 4.13, 7.2     | Generated rspamd password; commented rspamd config     | S  | open |
| 7.3.1–7.3.2   | GHCR multi-arch images, release bundle                 | M  | open |
| 7.3.3, 7.3.5  | `install.sh` wizard + update/backup/restore scripts    | L  | open |
| 4.11, 7.4     | Documentation rewrite & split; provider matrix         | M  | 4.11 ✅ done (`24993dc`), split (7.4) still open |
| 5.19, 5.20, 5.21, 5.22 | Privacy, Bayes, backup, provider docs         | S  | open |

### Phase 3 — Structure & features (ongoing)

| Finding     | Item                                                        | Cx |
| ----------- | ----------------------------------------------------------- | -- |
| 5.15, 7.5   | Incremental module restructure                               | L  |
| 5.16        | IMAP fake, workflow tests, e2e Compose test                  | L  |
| 7.1         | Lists v2: mailbox source of truth, domain entries, removal  | M  |
| 5.3         | Ham-trained keyword to prevent re-escalation                 | S  |
| 4.10        | Envelope/IP extraction for rspamd                            | M  |
| 5.11        | Configurable absolute-score thresholds                       | S  |
| 5.13        | Streaming/batched training fetch                             | S  |
| 5.23        | Heartbeat, generalized notifier, digest                      | M  |
| 6.21        | Release automation & changelog                               | S  |
| 5.22        | OAuth2 (Gmail / Microsoft)                                   | XL |

---

## 10. Appendix — evidence

**10.1 Unit tests (`npx vitest run`)**

```
× parseRspamdOutput > should parse Rspamd response with spam action
× Rspamd Maps Utility > updateMap > should create a new map file with normalized emails
× Rspamd Maps Utility > updateMap > should preserve sort order
Test Files  2 failed | 15 passed (17)
Tests       3 failed | 210 passed (213)
```

**10.2 Formatting (`npx prettier --check 'src/**/*.js' 'test/**/*.js'`)**

```
Code style issues found in 41 files.
```

**10.3 Outdated packages (`npm outdated`)**

```
Package      Current  Wanted  Latest
env-cmd       10.1.0  10.1.0  11.0.0
imapflow       1.2.9   1.7.8   2.0.5
pino          8.21.0  8.21.0  10.3.1
pino-pretty   10.3.1  10.3.1  13.1.3
prettier       3.6.2   3.9.7   3.9.7
vitest         3.2.4   3.2.7   5.0.1
yargs         17.7.2  17.7.3  18.1.0
```

**10.4 Audit (`npm audit --omit=dev`)**

```
nodemailer (via imapflow 1.0.77 – 1.4.1): 5 advisories (GHSA-p6gq-j5cr-w38f, GHSA-8m3c-c648-2xjj,
GHSA-wmmp-3585-3rmp, GHSA-2x7j-588g-ccc2, GHSA-cc9r-2j5m-2m83)
3 high severity vulnerabilities — fix available via `npm audit fix`
```

**10.5 Items marked (verify)** — confirm before implementing: 4.2 (behaviour on `/`-delimited server), 4.10 (missing SPF/IP symbols in rspamd history), 5.6 (effective DNS resolver), 5.8 (host dir ownership on Linux), 5.9 (pretty logs in image), 5.22 (keyword visibility per provider), 6.8 (8-bit message decoding), 7.2.11 (image `local.d` defaults), and the exact `require_symbols` syntax in 4.1.
