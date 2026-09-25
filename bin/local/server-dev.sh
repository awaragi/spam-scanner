#!/bin/bash
# Start the Nest server with the repo-root .env exported into the process.
#
# Usage (from anywhere):
#   bin/local/server-dev.sh
#
# Requires: npm install in app/server (or from repo root workspaces).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ENV_FILE="${PROJECT_ROOT}/.env"

if [ ! -f "${ENV_FILE}" ]; then
  echo "Error: .env not found at ${ENV_FILE}"
  echo "Copy .env.example and fill in values, or create .env at the repo root."
  exit 1
fi

load_env() {
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    if [[ "$line" =~ ^[[:space:]]*([^=]+)=(.*)$ ]]; then
      key="${BASH_REMATCH[1]}"
      value="${BASH_REMATCH[2]}"
      key=$(echo "$key" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
      export "$key"="$value"
    fi
  done < "${ENV_FILE}"
}

load_env

cd "${PROJECT_ROOT}/app/server"
exec npm run start:dev
