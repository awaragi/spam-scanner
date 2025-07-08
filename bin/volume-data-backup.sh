#!/bin/bash
set -e

# Check if destination folder is provided
if [ -z "$1" ]; then
  echo "Error: Destination folder not specified"
  echo "Usage: $0 <destination_folder>"
  exit 1
fi

DEST_FOLDER="$1"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="sa-data_backup_${TIMESTAMP}.tar.gz"

# Create destination folder if it doesn't exist
mkdir -p "$DEST_FOLDER"

# Backup data from sa-data volume to specified folder
echo "Backing up data from sa-data volume to $DEST_FOLDER/$BACKUP_FILE..."

# Use a temporary directory for the backup process
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

# Copy data from volume to temp directory
docker run --rm -v spamassassin-data:/data -v "$TEMP_DIR":/backup busybox cp -r /data/. /backup

# Create tar.gz archive
tar -czf "$DEST_FOLDER/$BACKUP_FILE" -C "$TEMP_DIR" .

echo "Backup completed successfully: $DEST_FOLDER/$BACKUP_FILE"