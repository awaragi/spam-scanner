#!/bin/bash
set -e

# Build the spam-scanner Docker image with a meaningful name
echo "Building spam-scanner Docker image..."
docker build -t spam-scanner:latest . 2>&1 | tee build.log

echo "Image built successfully!"
echo "You can now run the container using one of the provided scripts:"
echo "  - run-bash.sh: Launch the image and run interactive bash"
echo "  - run-bash-root.sh: Launch the image and run interactive bash as root"
echo "  - run-update.sh: Run the update command using root user"
echo "  - run-once.sh: Launch docker compose and execute the default command (once)"
echo "  - run-loop.sh: Launch docker compose and execute the loop command"
echo "  - run-reset.sh: Launch docker compose and execute the reset command"