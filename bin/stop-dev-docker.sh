#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export SPAM_SCANNER_TMUX_SESSION="${SPAM_SCANNER_TMUX_SESSION:-spam-scanner-dev-docker}"
# shellcheck source=lib/dev-common.sh
source "${SCRIPT_DIR}/lib/dev-common.sh"
local_had_session=false
if check_session_exists; then
  local_had_session=true
fi
if command -v tmux >/dev/null 2>&1; then
  kill_session_if_exists
else
  print_status "tmux not installed - skipping session cleanup."
fi
if [ "${local_had_session}" = true ] && [ -f "${REPO_ROOT}/.env" ] && command -v docker >/dev/null 2>&1; then
  print_status "Stopping local rspamd compose stack..."
  (cd "${REPO_ROOT}" && bin/local/rspamd.sh down) || print_error "rspamd compose down failed (continuing)"
fi
print_status "Docker dev stack stopped."
