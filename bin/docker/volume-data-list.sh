#!/bin/bash
set -e

# Launch the image and run interactive bash
echo "Launching spam-scanner container with interactive bash..."
docker run --rm -it --user root -v spamassassin-data:/data busybox ls -la /data
# Note: The container will be removed when you exit the bash shell