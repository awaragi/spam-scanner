#!/bin/bash
set -e

# Launch the image and run interactive bash
echo "Launching spam-scanner container with interactive bash..."
docker run --rm -it --no-healthcheck --name spam-scanner-shell -v spamassassin-data:/home/sauser/.spamassassin --entrypoint /bin/bash spam-scanner:latest

# Note: The container will be removed when you exit the bash shell