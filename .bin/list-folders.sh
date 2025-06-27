
#!/bin/bash

# Check if required IMAP environment variables are set
if [ -z "$IMAP_HOST" ]; then
    echo "Error: IMAP_HOST environment variable is not set."
    echo ""
    echo "Please set the required environment variables first:"
    echo "  export \$(cat .env | grep -v '^#' | xargs) && .bin/list-folders.sh"
    echo ""
    echo "Or manually export the variables:"
    echo "  export IMAP_HOST=imap.example.com"
    echo "  export IMAP_PORT=993"
    echo "  export IMAP_USER=user@example.com"
    echo "  export IMAP_PASSWORD=yourpassword"
    echo "  export IMAP_TLS=true"
    echo "  ./list-folders.sh"
    exit 1
fi

if [ -z "$IMAP_USER" ]; then
    echo "Error: IMAP_USER environment variable is not set."
    echo "Run: export \$(cat .env | grep -v '^#' | xargs) && ./list-folders.sh"
    exit 1
fi

if [ -z "$IMAP_PASSWORD" ]; then
    echo "Error: IMAP_PASSWORD environment variable is not set."
    echo "Run: export \$(cat .env | grep -v '^#' | xargs) && ./list-folders.sh"
    exit 1
fi

# Set defaults for optional variables
IMAP_PORT=${IMAP_PORT:-993}
IMAP_TLS=${IMAP_TLS:-true}

# Determine protocol based on TLS setting
if [ "$IMAP_TLS" = "true" ]; then
    PROTOCOL="imaps"
else
    PROTOCOL="imap"
fi

echo "Connecting to $PROTOCOL://$IMAP_HOST:$IMAP_PORT as $IMAP_USER"
echo "Listing all folders..."
echo ""

# Use curl to list IMAP folders
curl --url "$PROTOCOL://$IMAP_HOST:$IMAP_PORT" \
     --user "$IMAP_USER:$IMAP_PASSWORD" \
     --request "LIST \"\" \"*\""
