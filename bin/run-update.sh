#!/bin/bash
set -e

# Run the update command using root user
echo "Running SpamAssassin update as root user..."
docker run --rm --name spamassassin-updater --user root -v spamassassin-data:/home/sauser/.spamassassin --health-cmd='none' spam-scanner:latest update
echo "Update completed successfully!"