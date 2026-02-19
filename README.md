# spam-scanner

A modular IMAP spam scanner and trainer powered by Rspamd.  
Supports UID-based incremental scanning, mailbox-contained state, and both manual and automatic spam/ham training using Rspamd's HTTP API.

---

## Features

- IMAP inbox scanning using Rspamd HTTP API
- UID-based incremental progress tracking (no reprocessing)
- Manual spam/ham training via dedicated IMAP folders
- Whitelist and blacklist email maps with automatic updates
- Spam classification with different probability levels (low/high)
- All state stored inside the mailbox and mirrored to disk
- Runs in one-shot or continuous loop mode
- No external database or file storage required
- Docker-based Rspamd deployment

---

## Whitelist & Blacklist Maps

The application supports email address whitelisting and blacklisting via static Rspamd multimap rules:

- **Whitelist**: Emails from whitelisted senders receive -5.0 score adjustment (trusted senders)
- **Blacklist**: Emails from blacklisted senders receive +8.0 score adjustment (blocked senders)

Map files are simple text files with one email address per line (normalized to lowercase):

```
user1@trusted-company.com
user2@trusted-company.com
```

Training messages by moving them to the `INBOX.scanner.train-whitelist` or `INBOX.scanner.train-blacklist` folder will automatically extract sender addresses and add them to the corresponding map file. The map files are mounted in the Rspamd container and auto-reloaded.

---

## Folder Structure (IMAP)

| Purpose               | Default Folder         |
|------------------------|------------------------|
| Inbox to scan          | `INBOX`                |
| Spam destination       | `INBOX.spam`           |
| Manual spam training   | `INBOX.scanner.train-spam` |
| Manual ham correction  | `INBOX.scanner.train-ham` |
| Whitelist training     | `INBOX.scanner.train-whitelist` |
| Blacklist training     | `INBOX.scanner.train-blacklist` |
| Scanner state storage  | `INBOX.scanner.state`  |

Use the initialization script to auto-create the application folders.

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

### Optional (with defaults)

```env
FOLDER_INBOX=INBOX
FOLDER_SPAM=INBOX.spam
FOLDER_TRAIN_SPAM=INBOX.scanner.train-spam
FOLDER_TRAIN_HAM=INBOX.scanner.train-ham
FOLDER_TRAIN_WHITELIST=INBOX.scanner.train-whitelist
FOLDER_TRAIN_BLACKLIST=INBOX.scanner.train-blacklist
FOLDER_STATE=INBOX.scanner.state

SCAN_BATCH_SIZE=10000
SCAN_INTERVAL=300
SCAN_READ=true
PROCESS_BATCH_SIZE=10
STATE_KEY_SCANNER=scanner

LABEL_SPAM_LOW=Spam:Low
LABEL_SPAM_HIGH=Spam:High

RSPAMD_URL=http://localhost:11334
RSPAMD_PASSWORD=
RSPAMD_WHITELIST_MAP_PATH=rspamd/maps/whitelist.map
RSPAMD_BLACKLIST_MAP_PATH=rspamd/maps/blacklist.map

LOG_LEVEL=info
LOG_FORMAT=json
```

---

## Setup

### Local Development Setup

For local development with a standalone Rspamd instance:

### 1. Install Dependencies

Ensure you have the following installed:
- Node.js (v20 or higher)
- Docker and Docker Compose (for running Rspamd)

### 2. Setup Rspamd with Docker

Rspamd is configured to run in Docker. Start it with:

```bash
cd rspamd
docker-compose up -d
```

Rspamd will be available at `http://localhost:11334`.

To stop Rspamd:
```bash
docker-compose down
```

### 3. Install Application

```bash
git clone https://github.com/yourusername/spam-scanner.git
cd spam-scanner
npm install
```

### 4. Configure Environment

```bash
cp .env.example .env
# Edit .env with your IMAP and Rspamd settings
nano .env
```

### 5. Initialize Folders (one-time)

```bash
node src/init-folders.js
```

---

## Docker Deployment

For production deployment using Docker, all services (spam-scanner, Rspamd, Redis, Unbound) are orchestrated via a single docker-compose configuration.

### Prerequisites

- Docker Engine 20.10+
- Docker Compose v2.0+

### Quick Start

1. **Clone the repository**:
   ```bash
   git clone https://github.com/yourusername/spam-scanner.git
   cd spam-scanner
   ```

2. **Configure environment**:
   ```bash
   cp .env.example .env
   nano .env  # Edit with your IMAP credentials
   ```
   
   **Important**: In Docker deployment, `RSPAMD_URL` is automatically set to `http://rspamd:11334` (internal service communication). You only need to configure `RSPAMD_PASSWORD` and your IMAP credentials.

3. **Start all services**:
   ```bash
   docker-compose up -d
   ```

4. **View logs**:
   ```bash
   # Follow spam-scanner logs
   docker-compose logs -f spam-scanner
   
   # View all service logs
   docker-compose logs -f
   ```

5. **Stop services**:
   ```bash
   docker-compose down
   ```

### Docker Services

The docker-compose configuration includes four services:

- **spam-scanner**: Main application container running the scanning/training scripts
- **rspamd**: Spam filtering engine with machine learning
- **redis**: Cache and storage backend for Rspamd
- **unbound**: DNS resolver for Rspamd

### Data Persistence

The following data is persisted across container restarts using Docker volumes:

- **rspamd-data**: Bayes classifier database and statistics
- **rspamd-logs**: Rspamd service logs
- **redis-data**: Redis persistence data

Additionally, these directories are bind-mounted from your host:
- `./rspamd/config`: Rspamd configuration files
- `./rspamd/maps`: Whitelist and blacklist email maps

**Note**: Stopping and restarting containers (`docker-compose down` / `docker-compose up`) preserves all learned spam patterns and map configurations.

### Environment Variables for Docker

When using Docker deployment:

- **RSPAMD_URL**: Automatically set to `http://rspamd:11334` (do not override)
- **RSPAMD_PASSWORD**: Required in `.env` file (used for Rspamd web UI authentication)
- **IMAP_*** : All IMAP configuration must be set in `.env`
- **SCAN_INTERVAL**: Controls sleep time between scan cycles (default: 300 seconds)
- **LOG_FORMAT**: Use `json` for production, `pretty` for debugging

### Accessing Rspamd Web Interface

The Rspamd web interface is exposed on port 11334:

```
http://localhost:11334
```

Login with the password specified in your `.env` file (`RSPAMD_PASSWORD`).

### Rebuilding After Code Changes

After modifying source code:

```bash
docker-compose up --build -d
```

### Troubleshooting Docker Deployment

**Container won't start**:
- Check logs: `docker-compose logs spam-scanner`
- Verify `.env` file exists and contains required variables
- Ensure IMAP credentials are correct

**Cannot connect to Rspamd**:
- Verify all services are running: `docker-compose ps`
- Check Rspamd logs: `docker-compose logs rspamd`
- Restart services: `docker-compose restart`

**Data loss after restart**:
- Use `docker-compose down` (preserves volumes)
- Avoid `docker-compose down -v` (removes volumes)

### Local Development vs Docker

| Aspect | Local Development | Docker Deployment |
|--------|-------------------|-------------------|
| Rspamd | `cd rspamd && docker-compose up -d` | Included in root docker-compose.yml |
| Application | `./bin/local/start.sh` | Runs automatically in container |
| RSPAMD_URL | `http://localhost:11334` | `http://rspamd:11334` (auto-set) |
| State | Developers control script execution | Continuous loop in container |

---

## Setup (Legacy - for reference)

---

## Usage

### One-shot Mode (Manual Run)

Run the scripts in sequence:

```bash
node src/train-spam.js
node src/train-ham.js
node src/train-whitelist.js
node src/train-blacklist.js
node src/scan-inbox.js
```

### Continuous Mode (Loop)

Use the provided start script:

```bash
# Run with default .env file
./bin/local/start.sh

# Or specify a custom env file
./bin/local/start.sh .env.custom
```

This script:
1. Loads environment variables from the specified .env file
2. Runs all training and scanning scripts in sequence
3. Waits for the interval specified in SCAN_INTERVAL (default: 300 seconds)
4. Repeats the process indefinitely

You can press Enter during the wait period to skip the remaining wait time.

## Script Execution Order

The application runs the following steps in order:

1. `train-spam.js` - Process messages in spam training folder
2. `train-ham.js` - Process messages in ham training folder
3. `train-whitelist.js` - Process messages in whitelist training folder (placeholder for future)
4. `train-blacklist.js` - Process messages in blacklist training folder (placeholder for future)
5. `scan-inbox.js` - Scan inbox for spam messages

---

## Backup & Restore

### Backup Rspamd Data

The Rspamd state is stored in Docker volume. To backup:

```bash
docker-compose -f rspamd/docker-compose.yml exec rspamd /bin/bash -c "tar czf - -C /data ." > rspamd-data.tar.gz
```

### Restore Rspamd Data

```bash
docker-compose -f rspamd/docker-compose.yml exec -T rspamd /bin/bash -c "tar xzf - -C /data" < rspamd-data.tar.gz
```

### Backup Scanner State

```bash
node src/read-state.js > scanner-state.json
```

### Restore Scanner State

```bash
cat scanner-state.json | node src/write-state.js
```

---

## State Format (scanner-state.json)

```json
{
  "last_uid": 12394,
  "last_seen_date": "2025-06-26T11:02:44Z",
  "last_checked": "2025-06-26T11:07:12Z"
}
```

- `last_uid` is used for progress tracking
- Date fields are for reference only

---

## Development

### Local Development

```bash
npm install
export $(grep -v '^#' .env | xargs)  # inject env into shell
node src/init-folders.js
node src/scan-inbox.js
```

### CLI Tools

- `read-state.js` → reads IMAP state and prints JSON
- `write-state.js` → accepts JSON from stdin and updates IMAP
- `delete-state.js` → deletes scanner state from IMAP
- `reset-state.js` → resets the IMAP state to last_uid=0
- `uid-on-date.js FOLDER [--since date] [--write]` → finds first UID on/after a date
- `list-all.js` → lists all messages in a folder
- `read-email.js` → reads and displays a specific email
- `train-spam.js` → processes messages in spam training folder
- `train-ham.js` → processes messages in ham training folder
- `train-whitelist.js` → processes messages in whitelist training folder (placeholder for future)
- `train-blacklist.js` → processes messages in blacklist training folder (placeholder for future)

---

## Logging

### Configuration

The application uses centralized structured logging via Pino with configurable output formats.

**Environment Variables:**

- **`LOG_LEVEL`** (default: `info`) - Controls log verbosity
  - Options: `trace`, `debug`, `info`, `warn`, `error`, `fatal`
  - Use `debug` for development, `info` for production

- **`LOG_FORMAT`** (default: `json`) - Controls log output format
  - `json` or `jsonl` - Structured JSON format (one log entry per line, ideal for log aggregation)
  - `pretty` - Human-readable colored output (recommended for development)

**Examples:**

```bash
# Development (human-readable logs)
LOG_LEVEL=debug LOG_FORMAT=pretty node src/scan-inbox.js

# Production (structured JSON logs)
LOG_LEVEL=info LOG_FORMAT=json node src/scan-inbox.js
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

**Component names:**
- `config` - Configuration loading
- `imap` - IMAP operations
- `imapflow` - IMAP protocol library logs
- `rspamd` - Rspamd integration
- `rspamd-maps` - Email map file operations
- `email-utils` - Email parsing utilities
- `scan-inbox`, `train-spam`, etc. - Script-level operations

---

## License

MIT