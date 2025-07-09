#!/bin/bash
set -e

export ENTRYPOINT_MODE=loop
echo "Launching spam-scanner container with docker-compose ($ENTRYPOINT_MODE mode)..."
docker compose up -d

echo "Container started in loop mode (running in background)."
echo "To view logs: docker compose logs -f"
echo "To stop: docker compose down"