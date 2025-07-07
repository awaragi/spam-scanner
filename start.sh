#!/bin/bash

# Default sleep interval in seconds
SLEEP=300

if [ ! -f .env ]; then
    echo "Error: .env file not found!"
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
    done < .env
}

# Function to run a Node.js script with proper user and environment
run_script() {
    local script_name="$1"
    echo "Running $script_name..."
    # Pass all environment variables to sudo
    sudo -u debian-spamd --preserve-env env "PATH=$PATH" "NODE_PATH=$NODE_PATH" node "src/$script_name.js"
}

# Load environment variables safely
load_env

# Array of scripts to run in order
scripts=("train-spam" "train-ham" "train-whitelist" "scan-inbox")

while true
do
    echo "Starting spam scanner sequence..."
    
    # Run each script in the array
    for script in "${scripts[@]}"; do
        run_script "$script"
    done
    
    echo "Spam scanner sequence completed."
    echo "Waiting for $SLEEP seconds (press Enter to skip)..."
    
    # Use read with timeout
    if read -t $SLEEP; then
        echo "Sleep skipped by user input"
    fi
done