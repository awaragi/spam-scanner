# spam-scanner

A modular, containerized IMAP spam scanner and trainer powered by SpamAssassin.  
Supports UID-based incremental scanning, mailbox-contained state, and both manual and automatic spam/ham training.

---

## Features

- IMAP inbox scanning using `spamc` and `spamd`
- UID-based incremental progress tracking (no reprocessing)
- Manual spam/ham training via dedicated IMAP folders
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
FOLDER_STATE=INBOX.scanner.state

INIT_MODE=false
LOOP_MODE=false
SCAN_INTERVAL=300
SCAN_BATCH_SIZE=50

STATE_KEY_SCANNER=scanner
LOG_LEVEL=info
SYNC_STATE_FROM_FILE=false
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

Run `spamd` locally if needed:

```bash
docker run -d --name spamd -p 783:783 instrumentisto/spamassassin
```

### SpamAssassin Configuration

A sample TxRep configuration file `txrep.cf.example` is included. During local development, you can copy this to one of:

```bash
# System-wide configuration
sudo cp txrep.cf.example /etc/mail/spamassassin/txrep.cf

# User configuration
cp txrep.cf.example ~/.spamassassin/txrep.cf
```

The TxRep plugin improves spam detection by tracking message reputation scores.

If you installed spamd directly on your system:

**On Ubuntu/Debian:**
``` bash
sudo systemctl restart spamassassin
```
or
``` bash
sudo systemctl restart spamd
```


**On CentOS/RHEL:**
``` bash
sudo service spamassassin restart
```


### CLI Tools

- `read-state.js` → reads IMAP state and prints JSON
- `write-state.js` → accepts JSON from stdin and updates IMAP
- `uid-on-date.js FOLDER [--since date] [--write]` → finds first UID on/after a date

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

## License

MIT