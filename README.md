# spam-scanner

A modular IMAP spam scanner and trainer powered by Rspamd.  
Supports UID-based incremental scanning, mailbox-contained state, and both manual and automatic spam/ham training using Rspamd's HTTP API.

---

## Features

- IMAP inbox scanning using Rspamd HTTP API
- UID-based incremental progress tracking (no reprocessing)
- Manual spam/ham training via dedicated IMAP folders
- Spam classification with different probability levels (low/high)
- All state stored inside the mailbox and mirrored to disk
- Runs in one-shot or continuous loop mode
- No external database or file storage required
- Docker-based Rspamd deployment

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

SPAM_LABEL_LOW=Spam:Low
SPAM_LABEL_HIGH=Spam:High

RSPAMD_URL=http://localhost:11334
RSPAMD_PASSWORD=
```

---

## Setup

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

Rspamd will be available at `http://localhost:11333` (default `RSPAMD_URL`).

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

- Logs are JSON-formatted via `pino`
- Example entry:

```json
{
  "uid": 12455,
  "folder": "INBOX",
  "result": "spam",
  "msg": "Scanned message"
}
```

---

## License

MIT