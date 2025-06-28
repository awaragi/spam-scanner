#!/bin/bash
set -e

VAR_LIB_SPAMASSASSIN=/var/lib/spamassassin

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
  cat $VAR_LIB_SPAMASSASSIN/scanner-state.json | node write-state.js
  exit 0
fi

# Enhanced permission testing
# Check if VAR_LIB_SPAMASSASSIN exists, is readable and writable
if [ ! -d "$VAR_LIB_SPAMASSASSIN" ] || [ ! -r "$VAR_LIB_SPAMASSASSIN" ] || [ ! -w "$VAR_LIB_SPAMASSASSIN" ]; then
  echo "Error: $VAR_LIB_SPAMASSASSIN must exist, be readable and writable"
  exit 1
fi

# Test write permissions
TEST_FILE="$VAR_LIB_SPAMASSASSIN/write_test_$(date +%s).txt"
if ! echo "Write test" > "$TEST_FILE" 2>/dev/null; then
    echo "Error: Failed to write test file to $VAR_LIB_SPAMASSASSIN"
    exit 1
fi

# Verify read permissions
if [ ! -f "$TEST_FILE" ] || [ "$(cat "$TEST_FILE")" != "Write test" ]; then
    echo "Error: Failed to verify test file content in $VAR_LIB_SPAMASSASSIN"
    exit 1
fi
rm -f "$TEST_FILE"

# Test if SpamAssassin can create subdirectories (it often needs this)
TEST_SUBDIR="$VAR_LIB_SPAMASSASSIN/test_subdir_$(date +%s)"
if ! mkdir "$TEST_SUBDIR" 2>/dev/null; then
    echo "Error: Failed to create subdirectory in $VAR_LIB_SPAMASSASSIN"
    exit 1
fi
rmdir "$TEST_SUBDIR"

## Initialize Bayes database if it doesn't exist
#if [ ! -f "$VAR_LIB_SPAMASSASSIN/bayes_toks" ]; then
#    echo "Initializing SpamAssassin Bayes database..."
#    # Create a temporary empty message to initialize the database
#    echo "Subject: test" | sa-learn --ham --no-sync || true
#    sa-learn --sync
#fi
#
## Test SpamAssassin's ability to access the directory by running a simple SA command
#if ! sa-learn -D --dump magic 2>/dev/null >/dev/null; then
#    echo "Error: SpamAssassin may have issues accessing $VAR_LIB_SPAMASSASSIN"
#    echo "SpamAssassin typically requires at least 755 permissions"
##    echo "Sleeping for 5 minutes to give you chance to debug"
##    sleep 300
#    exit 1
#fi

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
