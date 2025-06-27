#!/bin/bash
set -e

function run_once() {
  node train-spam.js
  node train-ham.js
  node scan-inbox.js
  node read-state.js > /var/lib/spamassassin/scanner-state.json
}

echo "Starting spamd..."
spamd -d -c -m5
sleep 2

echo "Checking spamc..."
if ! echo "X-Spam-Check" | spamc -c >/dev/null 2>&1; then
  echo "ERROR: spamc failed — is spamd running?"
  exit 1
fi

if [ "$INIT_MODE" = "true" ]; then
  node init-folders.js
  exit 0
fi

if [ "$SYNC_STATE_FROM_FILE" = "true" ]; then
  cat /var/lib/spamassassin/scanner-state.json | node write-state.js
  exit 0
fi

if [ "$LOOP_MODE" = "true" ]; then
  while true; do
    run_once
    sleep "${SCAN_INTERVAL:-300}"
  done
else
  run_once
fi
