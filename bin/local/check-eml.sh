#!/usr/bin/env bash
set -euo pipefail

# Run a simple Rspamd checkv2 request against a local instance.

readonly RSPAMD_URL="http://localhost:11334/checkv2"
readonly RSPAMD_PASSWORD="mypassword"

usage() {
  cat <<'EOF'
Usage: check-rspamd.sh [--verbose] PATH

Arguments:
  PATH       Path to the .eml file (required)
  --verbose  Show full JSON output

Example:
  check-rspamd.sh "message.eml"
  check-rspamd.sh --verbose "message.eml"
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

  if [[ "$verbose" == "true" ]]; then
    curl -sS -X POST "$RSPAMD_URL" \
      -H "Content-Type: text/plain" \
      -H "Password: $RSPAMD_PASSWORD" \
      --data-binary "@$eml_path" | jq
    return
  fi

  curl -sS -X POST "$RSPAMD_URL" \
    -H "Content-Type: text/plain" \
    -H "Password: $RSPAMD_PASSWORD" \
    --data-binary "@$eml_path" | jq '{is_skipped, score, required_score, action}'
}

main "$@"
