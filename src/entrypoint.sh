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