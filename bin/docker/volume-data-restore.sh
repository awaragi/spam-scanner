#!/bin/bash
set -e

# Check if backup file is provided
if [ -z "$1" ]; then
  echo "Error: Backup file not specified"
  echo "Usage: $0 <backup_file.tar.gz>"
  exit 1
fi

BACKUP_FILE="$1"

# Check if backup file exists
if [ ! -f "$BACKUP_FILE" ]; then
  echo "Error: Backup file does not exist: $BACKUP_FILE"
  exit 1
fi

# Check if backup file is a gzip tar file
if ! file "$BACKUP_FILE" | grep -q "gzip compressed data"; then
  echo "Error: Backup file is not a gzip compressed file: $BACKUP_FILE"
  exit 1
fi

# Restore data to sa-data volume from specified backup file
echo "Restoring data to sa-data volume from $BACKUP_FILE..."

# Use a temporary directory for the restore process
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

# Extract backup file to temp directory
tar -xzf "$BACKUP_FILE" -C "$TEMP_DIR"

# Copy data from temp directory to volume
docker run --rm -v spamassassin-data:/data -v "$TEMP_DIR":/backup busybox sh -c "rm -rf /data/* && cp -r /backup/. /data"

echo "Restore completed successfully"