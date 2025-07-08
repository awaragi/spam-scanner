#!/bin/bash
set -e

# Run the update command using root user
echo "Running SpamAssassin update as root user..."
docker run --rm --no-healthcheck --user root --name spamassassin-updater -v spamassassin-data:/home/sauser/.spamassassin spam-scanner:latest update
echo "Update completed successfully!"