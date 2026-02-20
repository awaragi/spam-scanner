#!/bin/bash

# Default sleep interval in seconds
SLEEP=300

if [ -z "$1" ]; then
    ENV_FILE=".env"
else
    ENV_FILE="$1"
fi

if [ ! -f "$ENV_FILE" ]; then
    echo "Error: $ENV_FILE file not found!"
    exit 1
fi

# Function to safely load .env file
load_env() {
    # Read .env file line by line, ignoring comments and empty lines
    while IFS= read -r line || [[ -n "$line" ]]; do
        # Skip empty lines and comments
        [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
        
        # Extract key and value, handling special characters
        if [[ "$line" =~ ^[[:space:]]*([^=]+)=(.*)$ ]]; then
            key="${BASH_REMATCH[1]}"
            value="${BASH_REMATCH[2]}"
            
            # Remove leading/trailing whitespace from key
            key=$(echo "$key" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
            
            # Export the variable
            export "$key"="$value"
        fi
    done < "$ENV_FILE"
}

# Function to run a Node.js script
run_script() {
    local script_name="$1"
    echo ""
    echo ">>> Running ${script_name}..."
    node "src/$script_name.js"
    echo "<<< ${script_name} completed"
}

# Load environment variables safely
load_env

# Check if IMAP_HOST is set
if [ -z "$IMAP_HOST" ]; then
    echo "Error: IMAP_HOST environment variable is not set!"
    echo "Please set IMAP_HOST in your .env file."
    exit 1
fi

if [ -z "$IMAP_USER" ]; then
    echo "Error: IMAP_USER environment variable is not set!"
    echo "Please set IMAP_USER in your .env file."
    exit 1
fi

# Display startup information
echo "========================================="
echo "Starting spam-scanner..."
echo "========================================="
echo "IMAP Server: ${IMAP_HOST}:${IMAP_PORT:-993}"
echo "IMAP User: ${IMAP_USER}"
echo "Rspamd URL: ${RSPAMD_URL:-http://localhost:11334}"
echo "Scan Interval: ${SLEEP} seconds"
echo "========================================="

# Initialize IMAP folders once at startup
echo ""
echo "Initializing IMAP folders..."
run_script "init-folders"

# Array of scripts to run in loop (training and scanning)
scripts=("train-spam" "train-ham" "train-whitelist" "train-blacklist" "scan-inbox")

while true
do
    echo ""
    echo "========================================="
    echo "Starting spam-scanner sequence..."
    echo "========================================="
    
    # Run each script in the array
    for script in "${scripts[@]}"; do
        run_script "$script"
    done
    
    echo ""
    echo "========================================="
    echo "Spam scanner sequence completed."
    echo "Waiting for $SLEEP seconds (press Enter to skip)..."
    echo "========================================="
    
    # Use read with timeout
    if read -t $SLEEP; then
        echo "Sleep skipped by user input"
    fi
done