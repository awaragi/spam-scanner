#!/bin/bash
set -e

# Launch the image and run interactive bash
echo "Launching spam-scanner container with interactive bash..."
docker run --rm -it --user root --name spam-scanner-shell-root -v spamassassin-data:/home/sauser/.spamassassin --health-cmd='none' --entrypoint /bin/bash spam-scanner:latest

# Note: The container will be removed when you exit the bash shell