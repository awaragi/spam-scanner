#!/bin/bash
# Manage the local rspamd/redis/unbound stack for development.
#
# Usage (from project root or any directory):
#   bin/local/rspamd.sh init          Create external data directory structure
#   bin/local/rspamd.sh up            Start the stack (runs init if needed)
#   bin/local/rspamd.sh down          Stop the stack
#   bin/local/rspamd.sh logs          Tail container logs
#   bin/local/rspamd.sh <cmd>         Any other docker compose subcommand
#
# Uses --project-directory so Docker Compose resolves .env and relative volume
# paths from the project root regardless of current working directory.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.yml"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

require_env() {
    if [ ! -f "${PROJECT_ROOT}/.env" ]; then
        echo "Error: .env file not found at ${PROJECT_ROOT}/.env"
        echo "Copy .env.example to .env and set SPAM_SCANNER_DATA before running."
        exit 1
    fi
}

load_spam_scanner_data() {
    # Read SPAM_SCANNER_DATA from .env (Docker Compose does not expand ~)
    local value
    value=$(grep -E '^SPAM_SCANNER_DATA=' "${PROJECT_ROOT}/.env" | cut -d= -f2-)
    echo "${value:-${HOME}/.spam-scanner}"
}

# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

cmd_init() {
    require_env
    local data_dir
    data_dir=$(load_spam_scanner_data)

    echo "Initializing rspamd data directory at: ${data_dir}"

    mkdir -p \
        "${data_dir}/rspamd/data" \
        "${data_dir}/rspamd/logs" \
        "${data_dir}/rspamd/maps" \
        "${data_dir}/redis"

    # Create empty map files if they don't exist
    touch "${data_dir}/rspamd/maps/whitelist.map"
    touch "${data_dir}/rspamd/maps/blacklist.map"

    echo "Done. Directory structure:"
    find "${data_dir}" -maxdepth 3 -print | sort
}

compose() {
    docker compose \
        --project-directory "${PROJECT_ROOT}" \
        -f "${COMPOSE_FILE}" \
        "$@"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

ACTION="${1:-up}"

case "${ACTION}" in
    init)
        cmd_init
        ;;
    up)
        require_env
        # Auto-init if the data directory doesn't exist yet
        if [ ! -d "$(load_spam_scanner_data)" ]; then
            echo "Data directory not found — running init first..."
            cmd_init
        fi
        compose up -d
        ;;
    down)
        require_env
        compose down
        ;;
    logs)
        require_env
        compose logs -f
        ;;
    *)
        require_env
        compose "$@"
        ;;
esac
