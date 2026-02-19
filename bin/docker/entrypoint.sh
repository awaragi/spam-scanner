#!/bin/sh
set -e
set -u
set -o pipefail

# Default sleep interval (can be overridden by SCAN_INTERVAL env var)
SLEEP=${SCAN_INTERVAL:-300}

# Validate required environment variables
if [ -z "${IMAP_HOST:-}" ]; then
    echo "Error: IMAP_HOST environment variable is not set!"
    echo "Please set IMAP_HOST in your .env file or docker-compose environment."
    exit 1
fi

if [ -z "${IMAP_USER:-}" ]; then
    echo "Error: IMAP_USER environment variable is not set!"
    echo "Please set IMAP_USER in your .env file or docker-compose environment."
    exit 1
fi

# Display startup information
echo "========================================="
echo "Starting spam-scanner..."
echo "========================================="
echo "IMAP Server: ${IMAP_HOST}:${IMAP_PORT:-993}"
echo "IMAP User: ${IMAP_USER}"
echo "Rspamd URL: ${RSPAMD_URL:-http://rspamd:11334}"
echo "Scan Interval: ${SLEEP} seconds"
echo "========================================="

# Function to run a single script
run_script() {
    script_name="$1"
    echo ""
    echo ">>> Running ${script_name}..."
    node "/app/src/${script_name}.js"
    echo "<<< ${script_name} completed"
}

# Initialize IMAP folders once at startup
echo ""
echo "Initializing IMAP folders..."
run_script "init-folders"

# Array of scripts to run in loop (training and scanning)
SCRIPTS="train-spam train-ham train-whitelist train-blacklist scan-inbox"

# Main execution loop
while true; do
    echo ""
    echo "========================================="
    echo "Starting spam-scanner sequence..."
    echo "========================================="
    
    # Run each script in the sequence
    for script in ${SCRIPTS}; do
        run_script "${script}"
    done
    
    echo ""
    echo "========================================="
    echo "Spam scanner sequence completed."
    echo "Waiting for ${SLEEP} seconds..."
    echo "========================================="
    
    sleep "${SLEEP}"
done
