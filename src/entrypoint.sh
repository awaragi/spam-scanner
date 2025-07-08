#!/bin/bash
set -e

MODE="${ENTRYPOINT_MODE:-$1}"

# Function to run all training and scanning scripts
run_scripts() {
  node train-spam.js
  node train-ham.js
  node train-whitelist.js
  node scan-inbox.js
}

echo "Running mode: $MODE as user $(whoami)"

case "$MODE" in
  loop)
    spamd -d -c -m 5 --helper-home=/home/sauser -s stderr
    sleep 2
    while true; do
      run_scripts
      echo "Sleeping for $SCAN_INTERVAL"
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
    echo "Running sa-update..."
    # Run sa-update and capture its exit code properly
    if sa-update -v --gpgkey 24C063D8 --channel kam.sa-channels.mcgrail.com; then
        echo "Running sa-compile..."
        sa-compile
        echo "sa-compile completed"
    else
        echo "Skipping sa-compile due to sa-update not succeeding"
    fi

    # Ensure proper ownership after updates
    echo "Reset permissions on spamassassin user data"
    chown -R sauser:sauser /home/sauser/.spamassassin
    chmod 755 /home/sauser/.spamassassin
    echo "Update process completed"
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