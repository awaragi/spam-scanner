#!/bin/bash
# Simple script to sort blacklist and whitelist map files in place

MAPS_DIR="$(cd "$(dirname "$0")/../.."/rspamd/maps && pwd)"

echo "Sorting map files..."

# Sort whitelist.map
if [ -f "$MAPS_DIR/whitelist.map" ]; then
    sort -u "$MAPS_DIR/whitelist.map" -o "$MAPS_DIR/whitelist.map"
    echo "✓ Sorted whitelist.map"
fi

# Sort blacklist.map
if [ -f "$MAPS_DIR/blacklist.map" ]; then
    sort -u "$MAPS_DIR/blacklist.map" -o "$MAPS_DIR/blacklist.map"
    echo "✓ Sorted blacklist.map"
fi

echo "Done!"
