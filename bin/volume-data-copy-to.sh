#!/bin/bash
set -e

# Check if destination folder is provided
if [ -z "$1" ]; then
  echo "Error: Destination folder not specified"
  echo "Usage: $0 <destination_folder>"
  exit 1
fi

DEST_FOLDER="$1"

# Create destination folder if it doesn't exist
mkdir -p "$DEST_FOLDER"

# Copy data from sa-data volume to specified folder
echo "Copying data from sa-data volume to $DEST_FOLDER..."
docker run --rm -v spamassassin-data:/data -v "$DEST_FOLDER":/dest busybox cp -r /data/. /dest

echo "Data copied successfully to $DEST_FOLDER"
