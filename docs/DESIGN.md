# spam-scanner: Design & Operations Guide

A modular, containerized IMAP spam scanner and trainer powered by SpamAssassin.  
Supports UID-based incremental scanning, mailbox-contained state, and both manual and automatic spam/ham training.

---

## 1. Overview

This system provides a modular, containerized mail-processing pipeline that connects to a custom IMAP server and:

- Performs efficient UID-based incremental spam filtering using SpamAssassin (`spamc`)
- Scans the inbox in batches using `UID > last_uid`, ensuring scalable operation even with large mailboxes
- Enables manual spam and ham training using Thunderbird or any IMAP client
- Stores scanner state as a JSON message in the IMAP mailbox (`FOLDER_STATE`)
- Mirrors scanner state to disk in the SpamAssassin volume for backup
- Uses environment variables for complete configuration
- Supports one-shot or looped execution modes for flexible deployment

---

## 2. Architecture

### 2.1 IMAP Folder Structure

| Purpose               | Env Variable           | Default Value              | Created in Init? |
|------------------------|------------------------|----------------------------|------------------|
| Inbox                  | `FOLDER_INBOX`         | `INBOX`                    | No               |
| Spam destination       | `FOLDER_SPAM`          | `INBOX.spam`               | No               |
| Spam training folder   | `FOLDER_TRAIN_SPAM`    | `INBOX.scanner.train-spam` | Yes              |
| Ham training folder    | `FOLDER_TRAIN_HAM`     | `INBOX.scanner.train-ham`  | Yes              |
| Whitelist training     | `FOLDER_TRAIN_WHITELIST` | `INBOX.scanner.train-whitelist` | Yes      |
| Blacklist training     | `FOLDER_TRAIN_BLACKLIST` | `INBOX.scanner.train-blacklist` | Yes      |
| Scanner state folder   | `FOLDER_STATE`         | `INBOX.scanner.state`      | Yes              |

---

### 2.2 Configuration via Environment

Required:

```
IMAP_HOST
IMAP_PORT
IMAP_USER
IMAP_PASSWORD
IMAP_TLS
```

Optional (with defaults):

```
FOLDER_INBOX=INBOX
FOLDER_SPAM=INBOX.spam
FOLDER_TRAIN_SPAM=INBOX.scanner.train-spam
FOLDER_TRAIN_HAM=INBOX.scanner.train-ham
FOLDER_TRAIN_WHITELIST=INBOX.scanner.train-whitelist
FOLDER_TRAIN_BLACKLIST=INBOX.scanner.train-blacklist
FOLDER_STATE=INBOX.scanner.state
SCAN_BATCH_SIZE=50
SCAN_READ=false
PROCESS_BATCH_SIZE=10
STATE_KEY_SCANNER=scanner
LOG_LEVEL=info
SYNC_STATE_FROM_FILE=false
SPAM_LABEL_LOW=Spam:Low
SPAM_LABEL_HIGH=Spam:High
```

---

### 2.3 Core Scripts

| Script              | Description                                               |
|---------------------|-----------------------------------------------------------|
| `init-folders.js`   | Creates folders and exits (`INIT_MODE=true`)              |
| `train-spam.js`     | Trains SpamAssassin with `--spam` from TrainSpam          |
| `train-ham.js`      | Trains SpamAssassin with `--ham` from TrainHam            |
| `train-whitelist.js`| Trains SpamAssassin with `--ham` and adds senders to whitelist |
| `train-blacklist.js`| Trains SpamAssassin with `--spam` and adds senders to blacklist |
| `scan-inbox.js`     | Scans INBOX for new messages (UID > last_uid), detects spam |
| `read-state.js`     | Reads scanner state from IMAP, outputs JSON to stdout     |
| `write-state.js`    | Writes scanner state to IMAP, reads JSON from stdin       |
| `delete-state.js`   | Deletes scanner state from IMAP                           |
| `reset-state.js`    | Resets scanner state to last_uid=0                        |
| `uid-on-date.js`    | Finds UID of first message after a timestamp              |
| `list-all.js`       | Lists all messages in a folder                            |
| `read-email.js`     | Reads and displays a specific email                       |

---

## 3. Scanner Workflow

The scanner:

1. Loads scanner state (`last_uid`)
2. Scans for messages in `FOLDER_INBOX` with `UID > last_uid`
3. Pipes each message through `spamc`
4. Categorizes messages based on spam score:
   - Non-spam messages: Score percentage <= 30% (configurable)
   - Low probability spam: Score between 30-60% (configurable)
   - High probability spam: Score between 60-100% (configurable)
   - Definite spam: Explicitly marked as spam by SpamAssassin
5. Applies labels to messages:
   - Low probability spam: `SPAM_LABEL_LOW` (default: "Spam:Low")
   - High probability spam: `SPAM_LABEL_HIGH` (default: "Spam:High")
6. Moves definite spam messages to `FOLDER_SPAM`
7. Updates state and mirrors to `/var/lib/spamassassin/scanner-state.json`

State is tracked exclusively by UID. Dates are for reference only.

---

## 4. Training Flows

### Spam Training

- Folder: `FOLDER_TRAIN_SPAM`
- User moves known spam here
- `train-spam.js`:
  - `sa-learn --spam`
  - Move to `FOLDER_SPAM`

### Ham Training

- Folder: `FOLDER_TRAIN_HAM`
- User moves false positives here
- `train-ham.js`:
  - `sa-learn --ham`
  - Move back to `FOLDER_INBOX`

### Whitelist Training

- Folder: `FOLDER_TRAIN_WHITELIST`
- User moves messages from trusted senders here
- `train-whitelist.js`:
  - `sa-learn --ham`
  - Extract sender email addresses
  - Add senders to SpamAssassin whitelist in user_prefs
  - Move back to `FOLDER_INBOX`

### Blacklist Training

- Folder: `FOLDER_TRAIN_BLACKLIST`
- User moves messages from known spam senders here
- `train-blacklist.js`:
  - `sa-learn --spam`
  - Extract sender email addresses
  - Add senders to SpamAssassin blacklist in user_prefs
  - Move to `FOLDER_SPAM`

---

## 5. State Management

Stored as JSON in `FOLDER_STATE`, identified by:

- Subject: `AppState: scanner`
- Header: `X-App-State: scanner`

### Sample State

```json
{
  "last_uid": 12394,
  "last_seen_date": "2025-06-26T11:02:44Z",
  "last_checked": "2025-06-26T11:07:12Z"
}
```

State is also mirrored to:

```
/var/lib/spamassassin/scanner-state.json
```

---

## 6. Container Behavior

### Entrypoint: `start.sh`

```bash
# Start spamd
spamd -d -c -m5
sleep 2

# Check spamc
echo "X-Spam-Check" | spamc -c >/dev/null || exit 1

# Init
if [ "$INIT_MODE" = "true" ]; then node init-folders.js; exit 0; fi

# Sync state
if [ "$SYNC_STATE_FROM_FILE" = "true" ]; then cat /var/lib/spamassassin/scanner-state.json | node write-state.js; exit 0; fi

# Loop or run once
if [ "$LOOP_MODE" = "true" ]; then while true; do run_once; sleep "${SCAN_INTERVAL:-300}"; done; else run_once; fi
```

---

## 7. Development Modes

### Local

```bash
npm install
export $(cat .env | xargs)
node init-folders.js
node scan-inbox.js
```

Use `spamd` locally:

```bash
docker run -d --name spamd -p 783:783 instrumentisto/spamassassin
```

### Container

```bash
docker build -t spam-scanner .
docker run --rm --env-file .env -v spamdata:/var/lib/spamassassin spam-scanner
```

---

## 8. Deployment & Operations

### Cron Example

```bash
*/5 * * * * docker run --rm --env-file /etc/spam-scanner.env -v spamdata:/var/lib/spamassassin spam-scanner
```

### Backup

```bash
docker run --rm -v spamdata:/data -v $(pwd):/backup alpine   tar czf /backup/spamdata.tar.gz -C /data .
```

### Restore State

```bash
cat scanner-state.json | docker run -i spam-scanner node write-state.js
```

---

## 9. Docker Image & Node Dependencies

### Base Image

```Dockerfile
FROM node:20-slim
```

### System Packages

```Dockerfile
RUN apt-get update && apt-get install -y   spamassassin spamc gnupg ca-certificates   && apt-get clean   && rm -rf /var/lib/apt/lists/*
```

### Node Packages

```json
{
  "dependencies": {
    "imap": "^0.8.19",
    "mailparser": "^3.6.4",
    "yargs": "^17.7.2",
    "pino": "^8.14.1"
  }
}
```

- No `dotenv` required — use exported env vars
- Logs use `pino` (JSON format)
- CLI uses `yargs` for robust argument parsing

---

End of Document.
