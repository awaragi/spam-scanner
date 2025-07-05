# spam-scanner

A modular, containerized IMAP spam scanner and trainer powered by SpamAssassin.  
Supports UID-based incremental scanning, mailbox-contained state, and both manual and automatic spam/ham training.

---

## Features

- IMAP inbox scanning using `spamc` and `spamd`
- UID-based incremental progress tracking (no reprocessing)
- Manual spam/ham training via dedicated IMAP folders
- Whitelist training for trusted senders
- Spam classification with different probability levels (low/high)
- All state stored inside the mailbox and mirrored to disk
- Runs in one-shot (cron) or loop mode
- No external database or file storage required

---

## Folder Structure (IMAP)

| Purpose               | Default Folder         |
|------------------------|------------------------|
| Inbox to scan          | `INBOX`                |
| Spam destination       | `INBOX.spam`           |
| Manual spam training   | `INBOX.scanner.train-spam` |
| Manual ham correction  | `INBOX.scanner.train-ham` |
| Whitelist training     | `INBOX.scanner.train-whitelist` |
| Scanner state storage  | `INBOX.scanner.state`  |

Use `INIT_MODE=true` to auto-create the application folders.

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
FOLDER_STATE=INBOX.scanner.state

SCAN_BATCH_SIZE=50

SCAN_READ=false
PROCESS_BATCH_SIZE=5
STATE_KEY_SCANNER=scanner

SPAM_LABEL_LOW=Spam:Low
SPAM_LABEL_HIGH=Spam:High
```

---

## Setup

### 1. Build the image

```bash
docker build -t spam-scanner .
```

### 2. Initialize folders (one-time)

```bash
docker run --rm -e INIT_MODE=true --env-file .env spam-scanner
```

---

## Usage

### One-shot mode (cron)

```bash
docker run --rm --env-file .env -v spamdata:/var/lib/spamassassin spam-scanner
```

### Loop mode (always-on)

```bash
docker run -d   --env-file .env   -e LOOP_MODE=true   -v spamdata:/var/lib/spamassassin   spam-scanner
```

---

## Entrypoint Behavior

Runs the following steps in order:

1. Start `spamd` daemon
2. Run:
   - `train-spam.js`
   - `train-ham.js`
   - `scan-inbox.js`
   - `read-state.js > /var/lib/spamassassin/scanner-state.json`

---

## Backup & Restore

### Backup

```bash
docker run --rm -v spamdata:/data -v $(pwd):/backup alpine   tar czf /backup/spamdata.tar.gz -C /data .
```

### Restore Scanner State

```bash
cat scanner-state.json | docker run -i spam-scanner node write-state.js
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

### Local

```bash
npm install
export $(cat .env | xargs)  # inject env into shell
node init-folders.js
node scan-inbox.js
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
- `train-whitelist.js` → processes messages in whitelist training folder

---

### Environment variables

To load environment variables from command line
```bash
export $(grep -v '^#' .env.test.local | xargs)
```

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



# Running local

Having given up on running things within Docker with mapped volumes. Here is how I am running locally with 
- spamd service running as root
- spamd is configured with helper-home-dir=/var/lib/spamassassin
  - ```sudoedit /etc/default/spamd```
- debian-spamd as owner with home folder /var/lib/spamassassin 

Single execution
```shell
sudo -u debian-spamd env "PATH=$PATH" "NODE_PATH=$NODE_PATH" npm start
```

Infinit execution with 300 sec wait time in between
```shell
while true; do sudo -u debian-spamd env "PATH=$PATH" "NODE_PATH=$NODE_PATH" npm start; sleep 300; done
```


## License

MIT
