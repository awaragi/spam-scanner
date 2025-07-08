#!/bin/bash
set -e

# Launch docker compose and execute the default command (once)
echo "Launching spam-scanner container with docker-compose (reset mode)..."

# Run docker-compose
export ENTRYPOINT_MODE=reset
docker compose up

echo "Container execution completed."