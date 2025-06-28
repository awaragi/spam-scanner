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

# Enhanced permission testing
# Check if SA_STATE_PATH exists, is readable and writable
if [ ! -d "$SA_STATE_PATH" ] || [ ! -r "$SA_STATE_PATH" ] || [ ! -w "$SA_STATE_PATH" ]; then
  echo "Error: $SA_STATE_PATH must exist, be readable and writable"
  exit 1
fi

# Test write permissions
TEST_FILE="$SA_STATE_PATH/write_test_$(date +%s).txt"
if ! echo "Write test" > "$TEST_FILE" 2>/dev/null; then
    echo "Error: Failed to write test file to $SA_STATE_PATH"
    exit 1
fi

# Verify read permissions
if [ ! -f "$TEST_FILE" ] || [ "$(cat "$TEST_FILE")" != "Write test" ]; then
    echo "Error: Failed to verify test file content in $SA_STATE_PATH"
    exit 1
fi
rm -f "$TEST_FILE"

# Test if SpamAssassin can create subdirectories (it often needs this)
TEST_SUBDIR="$SA_STATE_PATH/test_subdir_$(date +%s)"
if ! mkdir "$TEST_SUBDIR" 2>/dev/null; then
    echo "Error: Failed to create subdirectory in $SA_STATE_PATH"
    exit 1
fi
rmdir "$TEST_SUBDIR"

# Test SpamAssassin's ability to access the directory by running a simple SA command
if ! sa-learn --dump magic 2>/dev/null >/dev/null; then
    echo "Error: SpamAssassin may have issues accessing $SA_STATE_PATH"
    echo "SpamAssassin typically requires at least 755 permissions"
    exit 1
fi

echo "Testing SpamAssassin configuration..."
spamassassin --lint

echo "Starting spamd..."
# Start spamd in daemon mode
spamd -d -c -m5 --syslog-socket=none --listen=127.0.0.1:783 --port=783

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
