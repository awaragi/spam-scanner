#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export SPAM_SCANNER_TMUX_SESSION="${SPAM_SCANNER_TMUX_SESSION:-spam-scanner-dev-mock}"
# shellcheck source=lib/dev-common.sh
source "${SCRIPT_DIR}/lib/dev-common.sh"
if command -v tmux >/dev/null 2>&1; then
  kill_session_if_exists
else
  print_status "tmux not installed - skipping session cleanup."
fi
kill_mock_rspamd_process
print_status "Mock dev stack stopped."
