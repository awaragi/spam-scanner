#!/bin/bash
set -e

SA_STATE_PATH="${PATH_SA_STATE:-/var/lib/spamassassin}"

function run_once() {
  node train-spam.js
  node train-ham.js
  node scan-inbox.js
  node read-state.js > $SA_STATE_PATH/scanner-state.json
}

if [ "$INIT_MODE" = "true" ]; then
  echo "INIT_MODE"
  node init-folders.js
  exit 0
fi

if [ "$SYNC_STATE_FROM_FILE" = "true" ]; then
  echo "SYNC_STATE_FROM_FILE"
  cat $SA_STATE_PATH/scanner-state.json | node write-state.js
  exit 0
fi

echo "Starting spamd..."
spamd -d -c -m5
sleep 2

echo "Checking spamc..."
if ! echo "X-Spam-Check" | spamc -c >/dev/null 2>&1; then
  echo "ERROR: spamc failed — is spamd running?"
  exit 1
fi

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
