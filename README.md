# spam-scanner

A modular IMAP spam scanner and trainer powered by Rspamd.
Supports UID-based incremental scanning, mailbox-contained state, and both manual and automatic spam/ham training using Rspamd's HTTP API.

---

## Features

- IMAP inbox scanning using Rspamd HTTP API
- UID-based incremental progress tracking (no reprocessing)
- Manual spam/ham/whitelist/blacklist training via dedicated IMAP folders
- Whitelist and blacklist sender lists, stored per mailbox in IMAP state (not a local file), with automatic updates
- Spam classification with four score-percentage tiers (clean/low/high/confirmed)
- Scanner state stored inside the mailbox itself (no external database) - but Redis and a host data directory are still required for Rspamd's own Bayes/statistics storage, see [Docker Deployment](#docker-deployment)
- Optional AI/LLM-based safety-net re-check of rspamd's non-confident buckets (see `AI_*` settings below)
- Single-run, poll-loop, or event-driven IMAP IDLE run modes
- Docker-based deployment (spam-scanner, Rspamd, Redis, Unbound)

---

## Quickstart (Local Setup)

The fastest path from a clean checkout to a running scanner. Everything here is covered in more depth further down (environment variables, folder mechanics, whitelist/blacklist, troubleshooting); this section exists so you don't have to jump around to get a working setup on the first try.

**Prerequisites**: Docker Engine 20.10+ and Docker Compose v2 (`docker compose`, not the old
`docker-compose` v1 CLI).

1. **Clone the repository**

   ```bash
   git clone git@github.com:awaragi/spam-scanner.git
   cd spam-scanner
   ```

2. **Configure your environment**

   ```bash
   cp .env.example .env
   nano .env
   ```

   At minimum, set:
   - `IMAP_HOST`, `IMAP_PORT`, `IMAP_USER`, `IMAP_PASSWORD` - your mailbox's IMAP credentials
   - `RSPAMD_PASSWORD` - pick your own; never reuse the example value
   - `SPAM_SCANNER_DATA` - an **absolute** path on the host for Rspamd/Redis data (Docker Compose
     does not expand `~`)
   - `SCAN_INTERVAL` - defaults to `0` (event-driven IDLE mode) when unset, which is what you want for a normal always-on Docker container. Set it to `-1` for single-run mode (e.g. cron/an external scheduler - the container exits after one cycle, and Compose's `restart: unless-stopped` just keeps relaunching it) or a poll interval in seconds (e.g. `300`) instead.

   (`RSPAMD_URL` is auto-set to the internal Docker service address and doesn't need editing.)

3. **Generate the Rspamd controller password**

   ```bash
   bin/local/hash-rspamd-password.sh
   ```

   Reads `RSPAMD_PASSWORD` from `.env` and writes `rspamd/config/worker-controller.inc`
   (gitignored - every install generates its own). Re-run this and `docker compose restart rspamd`
   whenever you change `RSPAMD_PASSWORD`.

4. **Start everything**

   ```bash
   docker compose up -d --build
   ```

   This builds and starts all four services: spam-scanner, rspamd, redis, unbound.

5. **Confirm it's working**

   ```bash
   docker compose logs -f spam-scanner
   ```

   On its very first cycle the app creates every IMAP folder it needs (`INBOX.scanner.state`, the four `INBOX.scanner.train.*` folders, `INBOX.spam`, and `INBOX.spam.low`/`INBOX.spam.high` when `SPAM_PROCESSING_MODE=folder`) before training or scanning anything - you'll see `Created folder` log lines for each. No manual init step is needed for this path.

6. **Seed spam/ham training with existing mail (optional but recommended)**

   Using any IMAP client, move a batch of messages you already know are spam into
   `INBOX.scanner.train.spam`, and messages you know are legitimate into
   `INBOX.scanner.train.ham`. The next training cycle drains the entire folder in one pass (however
   many messages are in it) - each one trains Rspamd's Bayes classifier, then moves to `FOLDER_SPAM`
   (spam) or back to `INBOX` (ham).

7. **Seed whitelist/blacklist (optional)**

   Move a message from a sender you always want to trust into `INBOX.scanner.train.whitelist`, or
   from one you always want treated as spam into `INBOX.scanner.train.blacklist`. The next cycle
   extracts the sender address into that mailbox's IMAP-stored list - see
   [Whitelist & Blacklist](#whitelist--blacklist) below for how matches are scored.

That's it - by default (`SCAN_INTERVAL=0`, IDLE mode) the container keeps re-training from those
four folders and scanning `INBOX` every time new mail arrives, with no further manual steps. See
[Docker Deployment](#docker-deployment) for the full production reference (multi-mailbox stacks,
data persistence, troubleshooting) and [Environment Variables](#environment-variables) for every
setting.

---

## Whitelist & Blacklist

Email address whitelisting and blacklisting is decided entirely in application code, keyed on the message's sender address - Rspamd itself is a stateless content scorer with no list or mailbox awareness, so the same Rspamd instance can safely be shared by more than one mailbox's scanner. Each mailbox's lists are stored as JSON in that mailbox's own IMAP state folder (the same folder and mechanism scanner progress already uses), not in a file on local disk.

Blacklist and whitelist are treated differently on purpose:

- **Blacklist**: an absolute override. A blacklisted sender is checked _before_ Rspamd is even called - the message is classified `confirmed` (moved to the spam folder) unconditionally, with no content scoring and no AI review.
- **Whitelist**: a score adjustment applied _after_ Rspamd responds, sized by whether the sender is authenticated - matching only the envelope `From` address is spoofable (the most common phishing pattern forges a trusted contact's address), so a whitelist hit alone isn't treated as proof of identity:
  - **Authenticated** (Rspamd's response includes a passing DKIM or DMARC symbol for the message): a full **−20** adjustment, and AI review is skipped.
  - **Unauthenticated** (address matched, but Rspamd found no passing DKIM/DMARC symbol): a reduced **−5** adjustment, and the message still goes through AI review like any other message - so a spoofed "trusted" address gets, at most, a small discount, never a free pass.
  - Either way, severe-enough content can still push the message into the `confirmed` tier despite the whitelist match.

If a sender is listed on both, blacklist wins.

Training messages by moving them to the `INBOX.scanner.train.whitelist` or `INBOX.scanner.train.blacklist` folder automatically extracts sender addresses and merges them into the corresponding mailbox-backed list.

### Importing, exporting, and backing up lists

If you're upgrading from a version that used local `whitelist.map`/`blacklist.map` files read by Rspamd's multimap module, import them once with `src/admin/import-list.js`:

```
node src/admin/import-list.js --list whitelist --file /path/to/whitelist.map
node src/admin/import-list.js --list blacklist --file /path/to/blacklist.map
```

`--file` is a plain path to any local file you can read - it has no relation to any env var or Docker mount. `--mode` defaults to `append` (merge with whatever's already in the mailbox's list); pass `--mode override` to replace the mailbox's list with exactly the file's contents instead. `--format` defaults to `txt` (one address per line, the legacy map format); pass `--format json` to import a JSON array instead - the same shape `export-list.js` produces and list state is stored in. Both `--mode` and `--format` are safe to run more than once.

`src/admin/export-list.js` is the reverse - dump a mailbox's list out, either for a human-readable backup (`--format txt`, the default) or for moving a list to another mailbox/account (`--format json`, which round-trips exactly through `import-list.js --format json --mode override`):

```
node src/admin/export-list.js --list whitelist --file whitelist-backup.txt
node src/admin/export-list.js --list whitelist --format json --file whitelist-backup.json
```

Omit `--file` on either script to print to standard output instead (useful for piping, e.g. `node src/admin/export-list.js --list whitelist | less`).

To back up or move a mailbox's _entire_ state - scanner progress plus both lists - in one file, use `export-mailbox-state.js`/`import-mailbox-state.js` instead of the per-list scripts above:

```
node src/admin/export-mailbox-state.js --file mailbox-backup.json
node src/admin/import-mailbox-state.js --file mailbox-backup.json --mode override
```

The bundle is a single JSON object (`{ scannerState, whitelist, blacklist }`), always all three on export. On import, only the keys present in the file are restored - a hand-edited or partial bundle (e.g. lists only) is fine. `--mode` applies to the lists only, the same `append`/`override` semantics as `import-list.js`; `scannerState`, when present, always fully replaces the destination's scanner state (it has no merge concept, matching how it's always behaved). Point `import-mailbox-state.js` at a different mailbox's IMAP credentials than the one you exported from to move an entire configuration between accounts. Use this pair for a full snapshot; use `import-list.js`/`export-list.js` for a single list, or `read-state.js`/`write-state.js` for scanner progress alone.

---

## Folder Structure (IMAP)

| Purpose                             | Default Folder                  |
| ----------------------------------- | ------------------------------- |
| Inbox to scan                       | `INBOX`                         |
| Spam destination (confirmed tier)   | `INBOX.spam`                    |
| Low-probability spam (folder mode)  | `INBOX.spam.low`                |
| High-probability spam (folder mode) | `INBOX.spam.high`               |
| Manual spam training                | `INBOX.scanner.train.spam`      |
| Manual ham correction               | `INBOX.scanner.train.ham`       |
| Whitelist training                  | `INBOX.scanner.train.whitelist` |
| Blacklist training                  | `INBOX.scanner.train.blacklist` |
| Scanner state storage               | `INBOX.scanner.state`           |

Folder names are configured as dot-separated paths and are automatically translated to your IMAP server's actual hierarchy delimiter (`.` or `/`) at startup - you don't need to know or match your server's delimiter when setting these.

Use the initialization step to auto-create the application folders:

```bash
node src/cli/init-folders.js
```

Training folders, the state folder, `FOLDER_SPAM` (the destination for rspamd's own confident "reject" verdict), and (when `SPAM_PROCESSING_MODE=folder`) the low/high spam folders are all created automatically - no folder needs to be created by hand.

---

## Environment Variables

### Required

```env
IMAP_HOST=imap.example.com
IMAP_PORT=993
IMAP_USER=user@example.com
IMAP_PASSWORD=yourpassword
IMAP_TLS=true
```

`IMAP_TLS` defaults to `true`; set it to `false` explicitly only for a server that doesn't
support TLS. Disabling it also requires `IMAP_ALLOW_INSECURE=true` as a second, deliberate
opt-in (configuration fails to load with `IMAP_TLS=false` alone) - and even then, STARTTLS
is enforced rather than merely attempted, so the connection fails outright if the server
doesn't support it, rather than silently falling back to a fully unencrypted connection.

Every environment variable is validated once at startup against a declarative schema: a
non-numeric value for a numeric field, an invalid `SPAM_PROCESSING_MODE`, inverted AI
escalation thresholds, or `AI_ENABLED=true` with no `AI_API_KEY` against the default OpenAI
endpoint all fail immediately with a clear, complete list of every problem found - rather
than misbehaving silently or failing later at first use. `IMAP_HOST`/`IMAP_USER`/
`IMAP_PASSWORD` have no default and must be set - every command-line entry point checks
this and fails fast, listing anything missing, before connecting to IMAP.

### Optional (with defaults)

```env
FOLDER_INBOX=INBOX
FOLDER_SPAM=INBOX.spam
FOLDER_SPAM_LOW=INBOX.spam.low
FOLDER_SPAM_HIGH=INBOX.spam.high
FOLDER_TRAIN_SPAM=INBOX.scanner.train.spam
FOLDER_TRAIN_HAM=INBOX.scanner.train.ham
FOLDER_TRAIN_WHITELIST=INBOX.scanner.train.whitelist
FOLDER_TRAIN_BLACKLIST=INBOX.scanner.train.blacklist
FOLDER_STATE=INBOX.scanner.state

# SCAN_INTERVAL controls the run mode:
#    0  = IDLE mode: event-driven, waits for IMAP EXISTS notifications (default)
#   -1  = single-run mode: run once and exit
#   >0  = poll mode: repeat every N seconds
SCAN_INTERVAL=0
SCAN_BATCH_SIZE=200
# SCAN_READ: when false, the scan query is restricted to unseen (\Seen-unset)
# messages only; true also rescans messages already marked read.
SCAN_READ=false
PROCESS_BATCH_SIZE=10

# SCAN_INITIAL_STATE: only matters the very first run against a mailbox with no
# saved state yet (once state exists, this is ignored):
#   new = skip everything already in the inbox, start from new mail only (default)
#   all = scan the entire existing inbox from the beginning
SCAN_INITIAL_STATE=new
MAX_RETRIES=5

# IDLE_WATCHDOG_MS: IDLE mode only (SCAN_INTERVAL=0). Re-cycles at least this
# often even without an EXISTS notification - guards against a silent
# connection drop and also polls the training folders, which IDLE itself
# doesn't watch. 0 disables it and waits indefinitely.
IDLE_WATCHDOG_MS=1200000

STATE_KEY_SCANNER=scanner

# SPAM_PROCESSING_MODE: label, or folder (default)
# - folder: moves messages to FOLDER_SPAM_LOW / FOLDER_SPAM_HIGH - visible in every IMAP client
# - label: applies IMAP keywords (Spam:Low, Spam:High) in place. This is NOT the same as Gmail
#   labels - many clients (Gmail, most mobile apps) don't surface IMAP keywords at all;
#   Thunderbird and some desktop clients do
SPAM_PROCESSING_MODE=folder

LABEL_SPAM_LOW=Spam:Low
LABEL_SPAM_HIGH=Spam:High

# Score-percentage thresholds ((score / required_score) * 100) that decide a
# message's tier - clean, low, high, or confirmed (moved to FOLDER_SPAM,
# skips AI). A blacklist match is always confirmed regardless of score; a
# whitelist match subtracts 20 from the score before this math runs if the
# sender is DKIM/DMARC-authenticated, or 5 if not (see Whitelist & Blacklist).
SPAM_CLEAN_THRESHOLD=30
SPAM_LOW_THRESHOLD=60
SPAM_CONFIRMED_THRESHOLD=200

RSPAMD_URL=http://localhost:11334
RSPAMD_PASSWORD=
# RSPAMD_TIMEOUT_MS: abort a stalled rspamd HTTP call (check/learn) after this many ms
RSPAMD_TIMEOUT_MS=30000
# RSPAMD_ENVELOPE_TRUSTED_HOPS: Received: headers to skip from the top (most
# recent) before reading the connecting IP/HELO for rspamd's SPF/DNSBL
# checks - see Envelope data below
RSPAMD_ENVELOPE_TRUSTED_HOPS=0

LOG_LEVEL=info
LOG_FORMAT=json
# LOG_FILTER_INCLUDES / LOG_FILTER_EXCLUDES: comma-delimited component name filters, both empty by default
```

### Envelope data sent to Rspamd

Every `/checkv2` request includes envelope data, resolved from the message itself rather than a live SMTP session, so Rspamd can evaluate SPF and IP-based DNSBL checks against the real sending relay (without it, Rspamd only sees DKIM/DMARC-derived signals):

- **IP / Helo** - the connecting IP and claimed HELO/EHLO name, read from the `Received:` header at position `RSPAMD_ENVELOPE_TRUSTED_HOPS` (counting from the top/most recent). The default, `0`, reads the topmost `Received:` header - correct for a single-MX setup where your mailbox provider's own server is the first hop to see the sender. If your provider forwards through an internal relay before final delivery, that relay adds its own `Received:` header above the one you actually want; increase `RSPAMD_ENVELOPE_TRUSTED_HOPS` to skip it.
- **From** - the envelope sender, read from `Return-Path:` (falls back to nothing if absent, never the message's own `From:` header).
- **Rcpt** - `IMAP_USER`, only when it looks like an email address (some self-hosted setups use a bare login instead).

Any field that can't be resolved is simply omitted from the request rather than guessed - Rspamd falls back to its DKIM/DMARC-only behavior for that field. The resolved `IP`/`Helo` are logged at `debug` level for troubleshooting; `From`/`Rcpt` and the message content are not.

### AI classification (optional safety-net escalation layer)

Disabled by default (`AI_ENABLED=false`) and a full no-op when disabled. When enabled, it re-checks rspamd's non-confident buckets (`nonSpam`/`lowSpam`) with an OpenAI-compatible LLM and can only escalate a message to a _more_ severe bucket, capped below `spam` - a human always reviews AI-flagged mail before anything is auto-moved to spam or used to train the filter. See the **Privacy** note below.

```env
AI_ENABLED=false
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=
# AI_MODEL is required when AI_ENABLED=true - there is no default, and the process fails
# fast at startup if this is unset while AI is enabled.
AI_MODEL=

AI_TIMEOUT_MS=15000
AI_MAX_RETRIES=1
AI_CONCURRENCY=5
AI_MAX_INPUT_TOKENS=6000
AI_MAX_OUTPUT_TOKENS=2000
AI_ESCALATE_TO_LOW_THRESHOLD=50
AI_ESCALATE_TO_HIGH_THRESHOLD=80
AI_USER_PROFILE=
AI_FAILURE_ALERT_THRESHOLD=3
```

See `.env.example` for the full, commented list of every setting, including exact defaults.

**Privacy**: when `AI_ENABLED=true`, full plain-text bodies (up to the `AI_MAX_INPUT_TOKENS` budget) plus From/To/Subject of every non-whitelisted, non-spam message are sent to whichever provider `AI_BASE_URL` points to. Use a local model (e.g. Ollama) for sensitive mailboxes if you'd rather not send content to a third party.

### Tuning the AI prompt offline

`src/cli/eval-prompt.js` scores a labeled `.eml` dataset with the current AI classifier prompt/config and writes a report, so prompt changes can be measured before they reach production instead of discovered later as false positives:

```bash
npx env-cmd -f .env node src/cli/eval-prompt.js \
  --reports .temp/reports \
  --ham .temp/messages/ham \
  --marketing .temp/messages/marketing \
  --spam .temp/messages/spam
```

`--reports` is mandatory - it's where the timestamped report file is written. `--ham`/`--marketing`/`--spam` each point at a folder of `.eml` files for that bucket; give whichever ones you have data for (at least one is required). There's no fixed folder convention - by habit this project keeps its dataset at `.temp/messages/{ham,marketing,spam}/` (gitignored, not checked in), but any folder path works. Each run writes a new timestamped report under `--reports` rather than overwriting the previous one, so a "before" and "after" report can be compared once the prompt in `buildSystemPrompt()` (`src/lib/clients/ai.client.js`) is edited. No new environment variables are involved - it reads the same `AI_*` settings as production. The `prompt-engineer` Claude Code skill (`.claude/skills/prompt-engineer/`) reads these reports and proposes prompt edits.

---

## Setup

### Local Development Setup

For local development with a standalone Rspamd instance:

#### 1. Install Dependencies

Ensure you have the following installed:

- Node.js v24 or higher (see `.nvmrc`; the Docker image targets `node:24-alpine`)
- Docker and Docker Compose v2 (`docker compose`, not the old `docker-compose` v1 CLI)

#### 2. Install the Application

```bash
git clone git@github.com:awaragi/spam-scanner.git
cd spam-scanner
npm install
```

(Use `https://github.com/awaragi/spam-scanner.git` instead of the `git@` URL if you don't have an SSH key configured with GitHub.)

#### 3. Configure Environment

```bash
cp .env.example .env
# Edit .env with your IMAP and Rspamd settings, and set SPAM_SCANNER_DATA to an absolute path
nano .env
```

#### 4. Start Rspamd (standalone, for local development)

```bash
bin/local/hash-rspamd-password.sh  # generates rspamd/config/worker-controller.inc from RSPAMD_PASSWORD in .env
bin/local/rspamd.sh up
```

Rspamd will be available at `http://localhost:11334` (bound to loopback only). To stop it:

```bash
bin/local/rspamd.sh down
```

#### 5. Initialize Folders (one-time)

```bash
node src/cli/init-folders.js
```

### Running Tests

```bash
npm test                 # unit tests (vitest)
npm run test:coverage    # unit tests with coverage; writes coverage/index.html
npm run test:integration # hits a real AI provider, loads .env via env-cmd
```

`test:coverage` covers `src/**` with the v8 provider. `src/cli/`/`src/admin/` scripts show as uncovered by design - they're thin `newClient()` → `connect()` → run → `safeLogout()` wrappers with no logic of their own; the workflow/step logic they call is what's under `src/lib/` and is what the coverage numbers there reflect. The `coverage/` directory is gitignored - open `coverage/index.html` locally to browse the report.

### Formatting

```bash
npm run format       # Prettier, writes changes
npm run format:check # Prettier, check only (no changes)
```

### Linting

```bash
npm run lint # ESLint (flat config, eslint.config.js) - reports only, no --fix wired up
```

Not yet enforced in CI (there is no CI yet). `eslint-config-prettier` is applied last so style rules Prettier already owns aren't duplicated - lint findings are about code correctness (unused vars, a caught error re-thrown without `cause`, etc.), not formatting.

### Testing Rspamd Directly

`bin/local/check-eml.sh` POSTs a `.eml` file straight to a running Rspamd instance's `/checkv2` endpoint and prints the score/action (or the full JSON with `--verbose`) - useful for checking Rspamd's own verdict on a message without going through the scanner at all. Reads `RSPAMD_URL`/`RSPAMD_PASSWORD` from the environment, falling back to `.env`. Requires `curl` and `jq`.

```bash
bin/local/check-eml.sh path/to/message.eml
bin/local/check-eml.sh --verbose path/to/message.eml
```

---

## Docker Deployment

For production deployment, all services (spam-scanner, Rspamd, Redis, Unbound) are orchestrated via a single `docker-compose.yml` at the repo root.

### Prerequisites

- Docker Engine 20.10+
- Docker Compose v2 (`docker compose`)

### Quick Start

1. **Clone the repository**:

   ```bash
   git clone git@github.com:awaragi/spam-scanner.git
   cd spam-scanner
   ```

2. **Configure environment**:

   ```bash
   cp .env.example .env
   nano .env  # Edit with your IMAP credentials, RSPAMD_PASSWORD, and SPAM_SCANNER_DATA
   ```

   **Important**: In Docker deployment, `RSPAMD_URL` is automatically set to `http://rspamd:11334` (internal service communication) regardless of what's in `.env`. `SPAM_SCANNER_DATA` must be an absolute path - Docker Compose does not expand `~`, and an unset value silently produces broken bind mounts.

3. **Generate the Rspamd controller password**:

   ```bash
   bin/local/hash-rspamd-password.sh
   ```

   This reads `RSPAMD_PASSWORD` from `.env` and writes `rspamd/config/worker-controller.inc` (gitignored - every install generates its own, there is no shared committed hash). Re-run it whenever `RSPAMD_PASSWORD` changes, then `docker compose restart rspamd`.

4. **Start all services**:

   ```bash
   docker compose up -d
   ```

5. **View logs**:

   ```bash
   docker compose logs -f spam-scanner
   docker compose logs -f
   ```

6. **Stop services**:
   ```bash
   docker compose down
   ```

### Docker Services

- **spam-scanner**: Main application container running the scanning/training orchestrator
- **rspamd**: Spam filtering engine with machine learning
- **redis**: Cache and storage backend for Rspamd's Bayes classifier
- **unbound**: DNS resolver for Rspamd

### Data Persistence

Everything Rspamd/Redis need to persist is bind-mounted from `${SPAM_SCANNER_DATA}` on the host:

- `${SPAM_SCANNER_DATA}/rspamd/data`: Bayes classifier database and statistics
- `${SPAM_SCANNER_DATA}/rspamd/logs`: Rspamd service logs
- `${SPAM_SCANNER_DATA}/redis`: Redis persistence data

Whitelist/blacklist entries are not stored here - they live in each mailbox's own IMAP state folder (see [Whitelist & Blacklist](#whitelist--blacklist)), so they travel with the mailbox rather than the host.

Additionally, `./rspamd/config` (from the repo) is bind-mounted read-only into the Rspamd container for configuration.

**Note**: `docker compose down` / `docker compose up` preserves all of the above (it's a host directory, not a named volume) - there's no separate volume-preservation step needed.

### Environment Variables for Docker

- **RSPAMD_URL**: Automatically set to `http://rspamd:11334` (do not override)
- **RSPAMD_PASSWORD**: Required in `.env`; run `bin/local/hash-rspamd-password.sh` after setting it (or changing it) to regenerate `rspamd/config/worker-controller.inc`, then `docker compose restart rspamd`. **If the password contains a literal `$`, escape it as `$$`** - Compose interpolates `.env` values wherever they're consumed (including via `env_file`), so an unescaped `$` starts what looks like a variable reference and gets silently dropped, truncating the password inside the container (the app will then get `401 Unauthorized` from `/checkv2`). `hash-rspamd-password.sh` un-escapes `$$` back to `$` before hashing, so the escaped form in `.env` and the hash stay in sync.
- **SPAM_SCANNER_DATA**: Required, absolute path
- **IMAP\_\***: All IMAP configuration must be set in `.env`
- **SCAN_INTERVAL**: Controls sleep time between scan cycles. Defaults to `0` (IDLE mode). Set to `-1` for single-run mode or a positive integer for poll mode
- **LOG_FORMAT**: Use `json` for production, `pretty` for debugging (note: `pino-pretty` is a devDependency and is not installed in the production image - `pretty` may not work inside the container as shipped)

### Accessing Rspamd Web Interface

Port `11334` is bound to the host's loopback interface only (`127.0.0.1:11334:11334`) - it is never reachable from the LAN or internet, only from the machine running Docker:

```
http://localhost:11334
```

On a remote server, use an SSH tunnel instead of publishing the port further: `ssh -L 11334:localhost:11334 user@server`, then browse to `http://localhost:11334` on your own machine.

Login with the password specified in your `.env` file (`RSPAMD_PASSWORD`).

### Rebuilding After Code Changes

```bash
docker compose up --build -d
```

### Troubleshooting Docker Deployment

**Container won't start**:

- Check logs: `docker compose logs spam-scanner`
- Verify `.env` file exists and contains required variables
- Ensure IMAP credentials are correct

**Cannot connect to Rspamd**:

- Verify all services are running: `docker compose ps`
- Check Rspamd logs: `docker compose logs rspamd`
- Restart services: `docker compose restart`

**Data loss after restart**:

- `docker compose down` (without `-v`) preserves the bind-mounted `${SPAM_SCANNER_DATA}` directory
- There are no named volumes to accidentally remove with `-v` in this setup, but avoid deleting `${SPAM_SCANNER_DATA}` on the host

### Local Development vs Docker

| Aspect      | Local Development                              | Docker Deployment                                                                |
| ----------- | ---------------------------------------------- | -------------------------------------------------------------------------------- |
| Rspamd      | `bin/local/rspamd.sh up`                       | Included in root `docker-compose.yml`                                            |
| Application | `./bin/local/start.sh <env-file>`              | Runs automatically in container                                                  |
| RSPAMD_URL  | `http://localhost:11334`                       | `http://rspamd:11334` (auto-set)                                                 |
| Run mode    | Controlled by `SCAN_INTERVAL` in your env file | Defaults to IDLE mode (`SCAN_INTERVAL=0`); set it for single-run or poll instead |

### Running Multiple Isolated Stacks

Neither compose file pins `container_name:`, and both declare their own project-scoped `spam-network` — so container and network names are derived from the Compose **project name**, not fixed strings. This means:

- **Note (BREAKING for anyone with existing muscle memory)**: fixed container names like `rspamd`, `spam-scanner`, `rspamd-redis` no longer exist. Use `docker compose exec <service> ...` / `docker compose logs <service>` (or `docker compose -p <name> exec ...` for a non-default project) instead of `docker exec rspamd ...` / `docker logs rspamd`.
- A dev stack and a production stack can both be "up" on the same host at once, as long as they use different Compose project names.
- You can run one full stack per mailbox (see multi-mailbox pattern below) without hand-editing container names.

To run two stacks side by side, give each a distinct project name with `-p` or `COMPOSE_PROJECT_NAME`:

```bash
# Production stack (default project name, derived from the directory name)
docker compose up -d

# A second, independent dev stack alongside it
COMPOSE_PROJECT_NAME=spam-scanner-dev bin/local/rspamd.sh up
```

Or for two independent mailboxes, each with its own `.env`:

```bash
docker compose -p spam-scanner-family --env-file .env.family up -d
docker compose -p spam-scanner-work --env-file .env.work up -d
```

Each project name gets its own containers (`<project>-<service>-1`) and its own network (`<project>_spam-network`), so the stacks never collide or see each other's traffic.

---

## Usage

### One-shot Mode (Manual Run, Individual Scripts)

```bash
node src/cli/train-spam.js
node src/cli/train-ham.js
node src/cli/train-whitelist.js
node src/cli/train-blacklist.js
node src/cli/scan-inbox.js
```

### Orchestrator (Recommended)

`src/cli/orchestrator.js` runs the full cycle - init (once), then training (spam/ham/whitelist/blacklist), then scan - according to `SCAN_INTERVAL`:

```bash
# IDLE mode (default, SCAN_INTERVAL=0): event-driven, waits for IMAP EXISTS notifications
node src/cli/orchestrator.js

# Single-run mode: one full cycle then exit
SCAN_INTERVAL=-1 node src/cli/orchestrator.js

# Poll mode: repeat every N seconds
SCAN_INTERVAL=300 node src/cli/orchestrator.js
```

Single-run mode is useful for scheduled execution via cron or an external scheduler. Poll and IDLE mode keep the process running.

In poll/IDLE mode, the orchestrator handles `SIGTERM`/`SIGINT` gracefully: it finishes the step currently in flight, then exits instead of being killed mid-cycle (`docker stop` sends `SIGTERM`, so a normal container stop/restart is safe).

Or use the provided start script, which loads environment variables from a `.env` file (the env-file argument is required):

```bash
./bin/local/start.sh .env
./bin/local/start.sh .env.custom
```

### Script Execution Order

The orchestrator runs the following steps in order on each cycle:

1. `train-spam` - Learn spam from the spam training folder
2. `train-ham` - Learn ham from the ham training folder
3. `train-whitelist` - Extract senders from the whitelist training folder into the mailbox's IMAP-backed whitelist
4. `train-blacklist` - Extract senders from the blacklist training folder into the mailbox's IMAP-backed blacklist
5. `scan-inbox` - Scan the inbox for spam messages

---

## Backup & Restore

There is no dedicated backup/restore tooling yet. The state that matters:

- **`${SPAM_SCANNER_DATA}`** (Rspamd Bayes data, Rspamd logs, Redis persistence) - a plain host directory, back it up with `tar`. Stopping the stack first is the simplest way to get a consistent snapshot:
  ```bash
  docker compose down
  tar czf spam-scanner-data-backup.tar.gz -C "$(dirname "$SPAM_SCANNER_DATA")" "$(basename "$SPAM_SCANNER_DATA")"
  docker compose up -d
  ```
  To back up without downtime, trigger a Redis snapshot and **wait for it to finish** before tarring - starting the tar while `BGSAVE` is still writing can capture a half-written RDB file:
  ```bash
  docker compose exec redis redis-cli BGSAVE
  until docker compose exec redis redis-cli INFO persistence | grep -q 'rdb_bgsave_in_progress:0'; do
    sleep 1
  done
  tar czf spam-scanner-data-backup.tar.gz -C "$(dirname "$SPAM_SCANNER_DATA")" "$(basename "$SPAM_SCANNER_DATA")"
  ```
  Restore by extracting the archive back to the same path and starting the stack.
- **Scanner state, and the whitelist/blacklist** (all stored as messages inside your mailbox's state folder, `FOLDER_STATE`) - covered by whatever backs up the mailbox itself (e.g. your IMAP provider's own backups); each can also be dumped/restored directly:

  ```bash
  node src/admin/read-state.js > scanner-state.json
  cat scanner-state.json | node src/admin/write-state.js

  node src/admin/export-list.js --list whitelist --format json --file whitelist-backup.json
  node src/admin/import-list.js --list whitelist --format json --mode override --file whitelist-backup.json

  # Or all three (scanner state + both lists) in one file:
  node src/admin/export-mailbox-state.js --file mailbox-backup.json
  node src/admin/import-mailbox-state.js --file mailbox-backup.json --mode override
  ```

- **`.env`** and any local edits to `rspamd/config/` - back these up yourself (they're not covered by `${SPAM_SCANNER_DATA}`).

---

## Upgrading

Back up first (see [Backup & Restore](#backup--restore) above) - an upgrade that goes wrong is much easier to recover from with a recent `${SPAM_SCANNER_DATA}`/`.env` snapshot in hand.

- **Rspamd / Redis** - both are version-pinned in `docker-compose.base.yml` (`rspamd/rspamd:3.14`, `redis:8-alpine`). Before bumping either, check that project's own release notes for breaking changes - a major Rspamd version can change Bayes classifier config compatibility (`rspamd/config/classifier-bayes.conf` and friends), and a major Redis version can change its persistence format. Bump the tag, then:
  ```bash
  docker compose pull
  docker compose up -d
  ```
- **spam-scanner itself** - no published image or version tag exists yet (see the roadmap), so upgrading means pulling the latest source and rebuilding:
  ```bash
  git pull
  docker compose up -d --build
  ```
- **Unbound** - pinned by image digest (see the comment in `docker-compose.base.yml`), not a tag; upgrading it means deliberately picking a new digest from [the image's releases](https://github.com/klutchell/unbound-docker) and updating that line.

If anything looks wrong after upgrading, restore the backup taken beforehand and `docker compose up -d` to roll back.

---

## State Format (scanner-state.json)

```json
{
  "last_uid": 12394,
  "last_seen_date": "2025-06-26T11:02:44Z",
  "last_checked": "2025-06-26T11:07:12Z",
  "uid_validity": "1690000000"
}
```

- `last_uid` is used for progress tracking
- Date fields are for reference only
- `uid_validity` (optional, added automatically) tracks the mailbox's IMAP `UIDVALIDITY`. If the server ever reports a different value (index rebuild, account migration), `last_uid` is reset to "new mail only" instead of trusting a UID that may now refer to a different message - state written before this field existed is still valid and gets it added on the next write

---

## CLI Tools

Admin/maintenance scripts live under `src/admin/`:

- `src/admin/read-state.js` - reads IMAP scanner state and prints JSON
- `src/admin/write-state.js` - accepts JSON from stdin and updates the IMAP state
- `src/admin/delete-state.js` - deletes scanner state from IMAP
- `src/admin/reset-state.js` - resets the IMAP state to `last_uid=0`
- `src/admin/uid-on-date.js FOLDER [--since date]` - finds the first UID on/after a date
- `src/admin/list-all.js` - lists all messages in a folder
- `src/admin/read-email.js` - reads and saves a specific email (edit the `UID`/`MESSAGE_ID` constants at the top of the script)

Top-level operational scripts live in `src/`:

- `src/cli/init-folders.js` - creates the application's IMAP folders
- `src/cli/train-spam.js`, `src/cli/train-ham.js`, `src/cli/train-whitelist.js`, `src/cli/train-blacklist.js` - run one training step
- `src/cli/scan-inbox.js` - run one scan step
- `src/cli/orchestrator.js` - run the full cycle (see [Usage](#usage))

---

## Logging

### Configuration

The application uses centralized structured logging via Pino with configurable output formats.

**Environment Variables:**

- **`LOG_LEVEL`** (default: `info`) - Controls log verbosity
  - Options: `trace`, `debug`, `info`, `warn`, `error`, `fatal`
  - Use `debug` for development, `info` for production
  - **Caution**: at `debug` level, `config` logs the full configuration object, which includes secrets (`IMAP_PASSWORD`, `RSPAMD_PASSWORD`, `AI_API_KEY`). Avoid pasting `debug`-level logs into public issues/chats.

- **`LOG_FORMAT`** (default: `json`) - Controls log output format
  - `json` or `jsonl` - Structured JSON format (one log entry per line, ideal for log aggregation)
  - `pretty` - Human-readable colored output (local development only - `pino-pretty` is not installed in the production Docker image)

**Examples:**

```bash
# Development (human-readable logs)
LOG_LEVEL=debug LOG_FORMAT=pretty node src/cli/orchestrator.js

# Production (structured JSON logs)
LOG_LEVEL=info LOG_FORMAT=jsonl node src/cli/orchestrator.js
```

### Log Structure

All logs include contextual information for tracing:

**Component-level logs:**

```json
{
  "level": "debug",
  "time": "2026-02-15T12:34:56.789Z",
  "component": "scan-controller",
  "from": 0,
  "to": 10,
  "total": 42,
  "msg": "Scanning batch"
}
```

**Message-level logs (with UID correlation):**

```json
{
  "level": "debug",
  "time": "2026-02-15T12:34:56.789Z",
  "component": "rspamd-check",
  "uid": 12455,
  "subject": "...",
  "action": "add header",
  "score": 8.5,
  "msg": "Rspamd check completed"
}
```

The `uid` field allows you to trace all operations related to a specific email message across the entire processing pipeline.

**Component names:**

- Core: `config`, `orchestrator`
- Clients (I/O boundary): `imap`, `imapflow`, `rspamd`, `ai-client`, `state-manager`, `folder-resolver`
- Workflow controllers: `scan-controller`, `train-controller`, `init-controller`, `sender-list-training-controller` (idle mode logs through `imap`, not its own component)
- Steps: `rspamd-check`, `rspamd-training`, `pending-messages`, `folder-move`, `spam-move`, `label-apply`, `list-update`, `ai-classification`, `ai-failure-alert`
- Services: `ai-content`, `sender-lists`
- Admin scripts (`src/admin/`): `export-list`, `import-list`, `export-mailbox-state`, `import-mailbox-state`, `read-state`, `read-email`, `list-all`

---

## License

MIT
