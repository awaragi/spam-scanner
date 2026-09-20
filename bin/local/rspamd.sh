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
#
# To run this dev stack alongside another stack (e.g. the production
# docker-compose.yml, or a second dev instance) on the same host, give it a
# distinct Compose project name so container/network names don't collide:
#   COMPOSE_PROJECT_NAME=spam-scanner-dev bin/local/rspamd.sh up

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
        "${data_dir}/redis"

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
        # worker-controller.inc is gitignored (no shared committed password
        # hash) - a fresh clone has none, which means an unauthenticated
        # controller until one is generated.
        if [ ! -f "${PROJECT_ROOT}/rspamd/config/worker-controller.inc" ]; then
            echo "Warning: rspamd/config/worker-controller.inc not found - the rspamd controller will start with no password."
            echo "Run bin/local/hash-rspamd-password.sh to generate one from RSPAMD_PASSWORD in .env."
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
