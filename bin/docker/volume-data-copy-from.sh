#!/bin/bash
set -e

# Check if source folder is provided
if [ -z "$1" ]; then
  echo "Error: Source folder not specified"
  echo "Usage: $0 <source_folder>"
  exit 1
fi

SOURCE_FOLDER="$1"

# Check if source folder exists
if [ ! -d "$SOURCE_FOLDER" ]; then
  echo "Error: Source folder does not exist: $SOURCE_FOLDER"
  exit 1
fi

# Copy data from specified folder to sa-data volume
echo "Copying data from $SOURCE_FOLDER to sa-data volume..."
docker run --rm \
  -v spamassassin-data:/data \
  -v "$SOURCE_FOLDER":/source \
  busybox \
  sh -c "cp -r /source/. /data && chown -R 1001:1001 /data"

echo "Data copied successfully to sa-data volume"
