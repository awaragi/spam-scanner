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

## Whitelist & Blacklist

Email address whitelisting and blacklisting is decided entirely in application code, keyed on the message's sender address - Rspamd itself is a stateless content scorer with no list or mailbox awareness, so the same Rspamd instance can safely be shared by more than one mailbox's scanner. Each mailbox's lists are stored as JSON in that mailbox's own IMAP state folder (the same folder and mechanism scanner progress already uses), not in a file on local disk.

Blacklist and whitelist are treated differently on purpose:

- **Blacklist**: an absolute override. A blacklisted sender is checked _before_ Rspamd is even called - the message is classified `confirmed` (moved to the spam folder) unconditionally, with no content scoring and no AI review.
- **Whitelist**: a **−20** adjustment to Rspamd's own content score, applied _after_ Rspamd responds. A whitelisted sender still skips AI review, but severe-enough content can still push the message into the `confirmed` tier despite the whitelist match - a spoofed "trusted" address doesn't get a free pass on content that's bad enough.

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
node src/init-folders.js
```

Training folders, the state folder, and (when `SPAM_PROCESSING_MODE=folder`) the low/high spam folders are created automatically. `FOLDER_SPAM` itself (the destination for rspamd's own confident "reject" verdict) is **not** auto-created as of this writing - create it manually, or point `FOLDER_SPAM` at your server's existing Junk folder.

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

`IMAP_TLS` defaults to `true`; set it to `false` explicitly only for a server that doesn't support TLS.

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
#   -1  = single-run mode: run once and exit (default)
#    0  = IDLE mode: event-driven, waits for IMAP EXISTS notifications
#   >0  = poll mode: repeat every N seconds
SCAN_INTERVAL=-1
SCAN_BATCH_SIZE=200
SCAN_READ=true
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
# whitelist match subtracts 20 from the score before this math runs.
SPAM_CLEAN_THRESHOLD=30
SPAM_LOW_THRESHOLD=60
SPAM_CONFIRMED_THRESHOLD=200

RSPAMD_URL=http://localhost:11334
RSPAMD_PASSWORD=

LOG_LEVEL=info
LOG_FORMAT=json
# LOG_FILTER_INCLUDES / LOG_FILTER_EXCLUDES: comma-delimited component name filters, both empty by default
```

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
node src/init-folders.js
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
- **SCAN_INTERVAL**: Controls sleep time between scan cycles. Defaults to `-1` (single-run mode). Set to `0` for IDLE mode or a positive integer for poll mode
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

| Aspect      | Local Development                              | Docker Deployment                                                      |
| ----------- | ---------------------------------------------- | ---------------------------------------------------------------------- |
| Rspamd      | `bin/local/rspamd.sh up`                       | Included in root `docker-compose.yml`                                  |
| Application | `./bin/local/start.sh <env-file>`              | Runs automatically in container                                        |
| RSPAMD_URL  | `http://localhost:11334`                       | `http://rspamd:11334` (auto-set)                                       |
| Run mode    | Controlled by `SCAN_INTERVAL` in your env file | Single-run by default; set `SCAN_INTERVAL` for continuous loop or IDLE |

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
node src/train-spam.js
node src/train-ham.js
node src/train-whitelist.js
node src/train-blacklist.js
node src/scan-inbox.js
```

### Orchestrator (Recommended)

`src/orchestrator.js` runs the full cycle - init (once), then training (spam/ham/whitelist/blacklist), then scan - according to `SCAN_INTERVAL`:

```bash
# Single-run mode (default, SCAN_INTERVAL=-1): one full cycle then exit
node src/orchestrator.js

# Poll mode: repeat every N seconds
SCAN_INTERVAL=300 node src/orchestrator.js

# IDLE mode: event-driven, waits for IMAP EXISTS notifications instead of polling
SCAN_INTERVAL=0 node src/orchestrator.js
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

- **`${SPAM_SCANNER_DATA}`** (Rspamd Bayes data, Rspamd logs, Redis persistence) - a plain host directory, back it up with `tar` after stopping the stack (or use `redis-cli BGSAVE` first for a consistent Redis snapshot while running):
  ```bash
  docker compose down
  tar czf spam-scanner-data-backup.tar.gz -C "$(dirname "$SPAM_SCANNER_DATA")" "$(basename "$SPAM_SCANNER_DATA")"
  docker compose up -d
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
- `src/admin/uid-on-date.js FOLDER [--since date] [--write]` - finds the first UID on/after a date
- `src/admin/list-all.js` - lists all messages in a folder
- `src/admin/read-email.js` - reads and saves a specific email (edit the `UID`/`MESSAGE_ID` constants at the top of the script)

Top-level operational scripts live in `src/`:

- `src/init-folders.js` - creates the application's IMAP folders
- `src/train-spam.js`, `src/train-ham.js`, `src/train-whitelist.js`, `src/train-blacklist.js` - run one training step
- `src/scan-inbox.js` - run one scan step
- `src/orchestrator.js` - run the full cycle (see [Usage](#usage))

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
LOG_LEVEL=debug LOG_FORMAT=pretty node src/orchestrator.js

# Production (structured JSON logs)
LOG_LEVEL=info LOG_FORMAT=json node src/orchestrator.js
```

### Log Structure

All logs include contextual information for tracing:

**Component-level logs:**

```json
{
  "level": "info",
  "time": "2026-02-15T12:34:56.789Z",
  "component": "rspamd",
  "folder": "INBOX",
  "msg": "Scanning batch"
}
```

**Message-level logs (with UID correlation):**

```json
{
  "level": "info",
  "time": "2026-02-15T12:34:56.789Z",
  "component": "rspamd",
  "uid": 12455,
  "score": 8.5,
  "action": "add header",
  "msg": "Rspamd check completed"
}
```

The `uid` field allows you to trace all operations related to a specific email message across the entire processing pipeline.

**Component names:** `config`, `imap`, `imapflow`, `rspamd`, `rspamd-maps`, `state-manager`, `folder-resolver`, `orchestrator`, and one per workflow (`scan-workflow`, `train-workflow`, `map-workflow`, `init-workflow`, `idle-workflow`).

---

## License

MIT
