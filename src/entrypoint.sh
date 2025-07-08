#!/bin/bash
set -e

MODE="${1:-$ENTRYPOINT_MODE}"

# Function to run all training and scanning scripts
run_scripts() {
  node train-spam.js
  node train-ham.js
  node train-whitelist.js
  node scan-inbox.js
}

case "$MODE" in
  loop)
    spamd -d -c -m 5 --helper-home=/home/sauser -s stderr
    sleep 2
    while true; do
      run_scripts
      sleep "${SCAN_INTERVAL:-300}"
    done
    ;;
  once)
    spamd -d -c -m 5 --helper-home=/home/sauser -s stderr
    sleep 2
    run_scripts
    ;;
  update)
    # Check if running as root for update operations
    if [ "$(id -u)" != "0" ]; then
      echo "Error: 'update' mode requires root privileges"
      echo "Please run with: docker run --rm --user root spam-scanner update"
      exit 1
    fi

    # Run sa-update and sa-compile as root (these write to privileged paths)
    sa-update --gpgkey 24C063D8 --channel kam.sa-channels.mcgrail.com
    sa-compile

    # Ensure proper ownership after updates
    chown -R sauser:sauser /home/sauser/.spamassassin
    chmod 700 /home/sauser/.spamassassin
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
