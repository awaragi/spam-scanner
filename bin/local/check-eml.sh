#!/usr/bin/env bash
set -euo pipefail

# Run a simple Rspamd checkv2 request against a local instance.
#
# Reads RSPAMD_URL / RSPAMD_PASSWORD from the environment if already set,
# otherwise falls back to the project's .env file, then to defaults. Never
# hardcodes a real password - every install has its own.

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

load_env_var() {
  local name="$1"
  local default_value="$2"

  if [[ -n "${!name:-}" ]]; then
    echo "${!name}"
    return
  fi

  if [[ -f "${PROJECT_ROOT}/.env" ]]; then
    local value
    value="$(grep -E "^${name}=" "${PROJECT_ROOT}/.env" | tail -n1 | cut -d= -f2-)"
    if [[ -n "${value}" ]]; then
      echo "${value}"
      return
    fi
  fi

  echo "${default_value}"
}

readonly RSPAMD_BASE_URL="$(load_env_var RSPAMD_URL "http://localhost:11334")"
readonly RSPAMD_URL="${RSPAMD_BASE_URL%/}/checkv2"
readonly RSPAMD_PASSWORD="$(load_env_var RSPAMD_PASSWORD "")"

usage() {
  cat <<'EOF'
Usage: check-eml.sh [--verbose] PATH

Arguments:
  PATH       Path to the .eml file (required)
  --verbose  Show full JSON output

Example:
  check-eml.sh "message.eml"
  check-eml.sh --verbose "message.eml"
EOF
}

require_command() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Error: missing required command: $cmd" >&2
    exit 1
  fi
}

main() {
  local eml_path=""
  local verbose="false"

  while [[ $# -gt 0 ]]; do
    case "$1" in
      --verbose)
        verbose="true"
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      -* )
        echo "Error: unknown option: $1" >&2
        usage
        exit 1
        ;;
      *)
        if [[ -n "$eml_path" ]]; then
          echo "Error: unexpected argument: $1" >&2
          usage
          exit 1
        fi
        eml_path="$1"
        shift
        ;;
    esac
  done

  if [[ -z "$eml_path" ]]; then
    echo "Error: PATH argument is required" >&2
    usage
    exit 1
  fi

  if [[ ! -f "$eml_path" ]]; then
    echo "Error: file not found: $eml_path" >&2
    exit 1
  fi

  require_command curl
  require_command jq

  local -a curl_args=(-sS -X POST "$RSPAMD_URL" -H "Content-Type: text/plain")
  if [[ -n "$RSPAMD_PASSWORD" ]]; then
    curl_args+=(-H "Password: $RSPAMD_PASSWORD")
  fi
  curl_args+=(--data-binary "@$eml_path")

  if [[ "$verbose" == "true" ]]; then
    curl "${curl_args[@]}" | jq
    return
  fi

  curl "${curl_args[@]}" | jq '{is_skipped, score, required_score, action}'
}

main "$@"
