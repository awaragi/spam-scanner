#!/bin/bash

# Default sleep interval in seconds
SLEEP=300

if [ ! -f .env ]; then
    echo "Error: .env file not found!"
    exit 1
fi

while true
do
  sudo -u debian-spamd env "PATH=$PATH" "NODE_PATH=$NODE_PATH" npm start
  echo "Waiting for $SLEEP seconds (press Enter to skip)..."
  
  # Use read with timeout
  if read -t $SLEEP; then
    echo "Sleep skipped by user input"
  fi
done