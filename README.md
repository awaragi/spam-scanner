# spam-scanner

A modular IMAP spam scanner and trainer powered by SpamAssassin.  
Supports UID-based incremental scanning, mailbox-contained state, and both manual and automatic spam/ham training.

---

## Features

- IMAP inbox scanning using `spamc` and `spamd`
- UID-based incremental progress tracking (no reprocessing)
- Manual spam/ham training via dedicated IMAP folders
- Whitelist training for trusted senders
- Blacklist training for known spam senders
- Spam classification with different probability levels (low/high)
- All state stored inside the mailbox and mirrored to disk
- Runs in one-shot or continuous loop mode
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
```

---

## Setup

### 1. Install Dependencies

Ensure you have the following installed:
- Node.js (v20 or higher)
- SpamAssassin (`spamd` and `spamc`)

On Debian/Ubuntu:
```bash
sudo apt-get update
sudo apt-get install spamassassin spamc
```

### 2. Configure SpamAssassin

SpamAssassin should be configured with:
- User: debian-spamd
- Home directory: /var/lib/spamassassin

Edit the SpamAssassin configuration:
```bash
sudo nano /etc/default/spamd
```

Ensure it contains:
```
OPTIONS="--create-prefs --max-children 5 --helper-home-dir=/var/lib/spamassassin"
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
# Edit .env with your IMAP settings
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
sudo -u debian-spamd env "PATH=$PATH" "NODE_PATH=$NODE_PATH" node src/train-spam.js
sudo -u debian-spamd env "PATH=$PATH" "NODE_PATH=$NODE_PATH" node src/train-ham.js
sudo -u debian-spamd env "PATH=$PATH" "NODE_PATH=$NODE_PATH" node src/train-whitelist.js
sudo -u debian-spamd env "PATH=$PATH" "NODE_PATH=$NODE_PATH" node src/train-blacklist.js
sudo -u debian-spamd env "PATH=$PATH" "NODE_PATH=$NODE_PATH" node src/scan-inbox.js
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

### Running as a Service (untested)

To run as a systemd service:

1. Create a service file:
```bash
sudo nano /etc/systemd/system/spam-scanner.service
```

2. Add the following content:
```
[Unit]
Description=IMAP Spam Scanner
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/path/to/spam-scanner
ExecStart=/path/to/spam-scanner/bin/local/start.sh
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

3. Enable and start the service:
```bash
sudo systemctl enable spam-scanner
sudo systemctl start spam-scanner
```

---

## Script Execution Order

The application runs the following steps in order:

1. `train-spam.js` - Process messages in spam training folder
2. `train-ham.js` - Process messages in ham training folder
3. `train-whitelist.js` - Process messages in whitelist training folder
4. `train-blacklist.js` - Process messages in blacklist training folder
5. `scan-inbox.js` - Scan inbox for spam messages

---

## Backup & Restore

### Backup SpamAssassin Data

```bash
sudo tar czf spamdata.tar.gz -C /var/lib/spamassassin .spamassassin
```

### Restore SpamAssassin Data

```bash
sudo tar xzf spamdata.tar.gz -C /var/lib/spamassassin
sudo chown -R debian-spamd:debian-spamd /var/lib/spamassassin/.spamassassin
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
- `train-whitelist.js` → processes messages in whitelist training folder
- `train-blacklist.js` → processes messages in blacklist training folder

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