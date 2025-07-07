<!--
DOCKER ROLE: spam-filtering
TECH STACK: Node.js, SpamAssassin, cron, IMAP
ENTRY MODES: once, loop, update, reset
REQUIRES: IMAP credentials, user volume
VOLUME: /home/sauser/.spamassassin
DEFAULT PORT: 783
-->


# DOCKER.md – Spam Scanner Container Design

A production-ready Docker container for SpamAssassin scanning, training, and rule maintenance, integrated with a modular Node.js mail processor.

---

## 📚 Table of Contents

1. [Image Structure](#-image-structure)
2. [User Model](#-user-model)
3. [File Layout](#-file-layout)
4. [Entrypoint & Runtime Modes](#-entrypoint--runtime-modes)
5. [entrypoint.sh Example](#-entrypointsh-example)
6. [Healthcheck](#-healthcheck)
7. [Rule Updates](#-rule-updates-sa-update)
8. [Backup & Restore](#-backup--restore)
9. [Logging](#-logging)
10. [Sample Cron for Update](#-sample-cron-for-update)
11. [Sample Docker Compose File](#-sample-docker-compose-file)
12. [GPG Key Import](#-gpg-key)
13. [Sample Dockerfile](#-sample-dockerfile)

---

## 🧱 Image Structure

### Base Image
- `node:20-slim` (Debian-based)

### System Packages Installed
- `spamassassin`, `spamc`, `sa-compile`, `gnupg`, `re2c`, `make`, `gcc`, `tini`

---

## 👤 User Model

- Runtime user: `sauser`
- Home directory: `/home/sauser`
- Persistent volume: `/home/sauser/.spamassassin` (contains Bayes DB + `user_prefs`)

---

## 📁 File Layout

| Path                          | Purpose                                |
|-------------------------------|----------------------------------------|
| `/app/`                       | Application code (Node scripts)        |
| `/home/sauser/.spamassassin/` | Persistent SA state (volume-mounted)   |

App Directory Structure:

```
/app
  ├── entrypoint.sh
  ├── scan-inbox.js
  ├── train-spam.js
  ├── train-ham.js
  ├── train-whitelist.js
  ├── reset-state.js
  ├── shared/
  ├── package.json
  └── package-lock.json
```

---

## 🚀 Entrypoint & Runtime Modes

The container accepts **either**:

- Environment variable: `ENTRYPOINT_MODE=once|loop|update|reset`
- Or command-line argument: `once|loop|update|reset`

### Supported Modes

| Mode   | Description                                                  |
|--------|--------------------------------------------------------------|
| `once` | Train (spam, ham, whitelist), then scan inbox once          |
| `loop` | Same as `once`, repeated every `$SCAN_INTERVAL` seconds     |
| `update` | Runs `sa-update` and `sa-compile`, then exits               |
| `reset` | Resets scanner state (resets IMAP UID state to 0)          |

### Dockerfile Entrypoint and CMD

```dockerfile
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["once"]
```

---

## 🧠 entrypoint.sh Example

```bash
#!/bin/bash
set -e

MODE="${ENTRYPOINT_MODE:-$1}"

case "$MODE" in
  loop)
    spamd -d -c -m 5 --helper-home=/home/sauser -s stderr
    sleep 2
    while true; do
      node train-spam.js
      node train-ham.js
      node train-whitelist.js
      node scan-inbox.js
      sleep "${SCAN_INTERVAL:-300}"
    done
    ;;
  once)
    spamd -d -c -m 5 --helper-home=/home/sauser -s stderr
    sleep 2
    node train-spam.js
    node train-ham.js
    node train-whitelist.js
    node scan-inbox.js
    ;;
  update)
    sa-update --gpgkey 24C063D8 --channel kam.sa-channels.mcgrail.com
    sa-compile
    ;;
  reset)
    node reset-state.js
    ;;
  *)
    echo "Unknown mode: $MODE"
    echo "Usage: ENTRYPOINT_MODE=<mode> or docker run ... <mode>"
    exit 1
    ;;
esac
```

---

## 🧪 Healthcheck

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3   CMD echo "X-Spam-Check" | spamc -c > /dev/null || exit 1
```

> Use `--no-healthcheck` when running update-only containers.

---

## 🛡 Rule Updates (sa-update)

Updates are **performed externally** (e.g. via host cron):

```bash
docker stop spam-scanner
docker run --rm --no-healthcheck -v spamassassin-data:/home/sauser/.spamassassin spam-scanner update
docker start spam-scanner
```

---

## 📦 Backup & Restore

```bash
# Timestamped Backup
TS=$(date +%Y%m%d-%H%M%S)
docker run --rm -v spamassassin-data:/data -v $(pwd):/backup alpine   tar czf /backup/sa-userdata-$TS.tar.gz -C /data .

# Restore
docker run --rm -v spamassassin-data:/data -v $(pwd):/backup alpine   tar xzf /backup/sa-userdata-20250704-030000.tar.gz -C /data
```

---

## 📤 Logging

| Component | Output     |
|-----------|------------|
| `spamd`   | `stderr` via `-s stderr` |
| Node.js   | `stdout` via `pino` JSON logger |
| Level     | Controlled via `LOG_LEVEL` env (default: `info`) |

---

## 🧰 Sample Cron for Update

```cron
0 3 * * * docker stop spam-scanner &&           docker run --rm --no-healthcheck -v spamassassin-data:/home/sauser/.spamassassin spam-scanner update &&           docker start spam-scanner
```

---

## 🐳 Sample Docker Compose File

```yaml
version: "3.9"
services:
  spam-scanner:
    image: spam-scanner
    restart: unless-stopped
    user: "1000:1000"
    environment:
      ENTRYPOINT_MODE: loop
      SCAN_INTERVAL: 300
      LOG_LEVEL: info
    volumes:
      - spamassassin-data:/home/sauser/.spamassassin
    healthcheck:
      test: ["CMD-SHELL", "echo 'X-Spam-Check' | spamc -c > /dev/null || exit 1"]
      interval: 30s
      timeout: 5s
      retries: 3

volumes:
  spamassassin-data:
```

---

## 🧾 GPG Key

The GPG key for KAM ruleset is imported at build time:

```dockerfile
RUN wget https://mcgrail.com/downloads/kam.sa-channels.mcgrail.com.key     && sa-update --import kam.sa-channels.mcgrail.com.key     && rm kam.sa-channels.mcgrail.com.key
```

---

## 📄 Sample Dockerfile

```dockerfile
FROM node:20-slim

RUN apt-get update && apt-get install -y \
    spamassassin spamc sa-compile gnupg re2c gcc make tini \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

RUN useradd -ms /bin/bash sauser

COPY ./app /app
WORKDIR /app

RUN chown -R sauser:sauser /app

RUN wget https://mcgrail.com/downloads/kam.sa-channels.mcgrail.com.key \
    && sa-update --import kam.sa-channels.mcgrail.com.key \
    && rm kam.sa-channels.mcgrail.com.key

RUN npm ci --omit=dev

USER sauser
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["once"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD echo "X-Spam-Check" | spamc -c > /dev/null || exit 1
```

---


## 🌐 Required and Optional Environment Variables

| Variable            | Required | Default   | Description                                 |
|---------------------|----------|-----------|---------------------------------------------|
| `ENTRYPOINT_MODE`   | ❌       | `once`    | Run mode: `once`, `loop`, `update`, `reset` |
| `SCAN_INTERVAL`     | ❌       | `300`     | Seconds between loops in `loop` mode        |
| `LOG_LEVEL`         | ❌       | `info`    | Logging verbosity (via `pino`)              |
| `IMAP_HOST`         | ✅       | —         | IMAP server address                          |
| `IMAP_USER`         | ✅       | —         | IMAP username                                |
| `IMAP_PASSWORD`     | ✅       | —         | IMAP password                                |
| `IMAP_PORT`         | ✅       | —         | IMAP server port                             |
| `IMAP_TLS`          | ❌       | `true`    | Use TLS (`true` or `false`)                  |


## 📁 Build Context Requirements

To build the Docker image successfully, the following structure must exist:

```
./
  ├── src/
  │   ├── entrypoint.sh
  │   ├── scan-inbox.js
  │   ├── train-*.js
  │   ├── lib/
  │   ├── package.json
  │   └── package-lock.json
  ├── .env (optional for local use)
  └── Dockerfile
```


## 🔧 Build & Run Examples

### Build Image

```bash
docker build -t spam-scanner .
```

### Run in One-Shot Mode

```bash
docker run --rm -v spamassassin-data:/home/sauser/.spamassassin spam-scanner once
```

### Run in Loop Mode with Compose

```bash
docker-compose up -d
```

### Run Update and Recompile Rules

```bash
docker run --rm --no-healthcheck -v spamassassin-data:/home/sauser/.spamassassin spam-scanner update
```


## ✅ Test Instructions

To confirm the container is healthy:

```bash
docker exec spam-scanner spamc -c <<< "X-Spam-Check"
```

Expected output: spam score and required threshold.

To test training scripts, place known spam/ham `.eml` messages into `/home/sauser/.spamassassin/train/` and invoke:

```bash
node train-spam.js
```
