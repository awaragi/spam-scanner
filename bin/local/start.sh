#!/bin/bash

if [ -z "$1" ]; then
    echo "Error: ENV file parameter is required!"
    echo "Usage: $0 <env-file>"
    exit 1
fi

ENV_FILE="$1"

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

# Load environment variables safely
load_env

exec node src/orchestrator.js