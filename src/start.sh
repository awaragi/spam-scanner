#!/bin/bash
set -e

# Verify required environment variables
for var in IMAP_HOST IMAP_USER IMAP_PASSWORD; do
    if [ -z "${!var}" ]; then
        echo "Error: $var environment variable is not set"
        exit 1
    fi
done

if [ -z "$PROCESS_BATCH_SIZE" ]; then
    PROCESS_BATCH_SIZE=10
fi

function run_once() {
  node train-spam.js
  node train-ham.js
  node scan-inbox.js
  node read-state.js > $VAR_LIB_SPAMASSASSIN/scanner-state.json
}

if [ "$INIT_MODE" = "true" ]; then
  echo "INIT_MODE"
  node init-folders.js
  node reset-state.js | node write-state.js
  exit 0
fi

if [ "$SYNC_STATE_FROM_FILE" = "true" ]; then
  echo "SYNC_STATE_FROM_FILE"
  cat $HOME/.spamassassin/scanner-state.json | node write-state.js
  exit 0
fi

# Enhanced permission testing
# check if it's readable and writable
if [ ! -d "$HOME/.spamassassin/" ] || [ ! -r "$HOME/.spamassassin/" ] || [ ! -w "$HOME/.spamassassin/" ]; then
  echo "Error: $HOME/.spamassassin/ must exist, be readable and writable"
  exit 1
fi

echo "Testing SpamAssassin configuration..."
spamassassin --lint

# Start spamd in daemon mode
echo "Starting spamd with parameters:"
echo "  -d (daemon mode)"
echo "  -c (create user preferences file)"
echo "  -m $PROCESS_BATCH_SIZE (max children)"
echo "  --syslog-socket=none"
echo "  --listen=127.0.0.1 --port=783"
spamd --version
spamd -d -c -m $PROCESS_BATCH_SIZE \
  --syslog-socket=none \
  --listen=127.0.0.1 --port=783

# Wait a moment for spamd to start
sleep 3

if [ "$LOOP_MODE" = "true" ]; then
  echo "LOOP_MODE"
  while true; do
    run_once
    sleep "${SCAN_INTERVAL:-300}"
  done
else
  echo "RUN_ONCE"
  run_once
fi
