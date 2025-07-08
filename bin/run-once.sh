#!/bin/bash
set -e

export ENTRYPOINT_MODE=once
echo "Launching spam-scanner container with docker-compose ($ENTRYPOINT_MODE mode)..."
docker compose up

echo "Container execution completed."