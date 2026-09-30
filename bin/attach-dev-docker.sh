#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export SPAM_SCANNER_TMUX_SESSION="${SPAM_SCANNER_TMUX_SESSION:-spam-scanner-dev-docker}"
# shellcheck source=lib/dev-common.sh
source "${SCRIPT_DIR}/lib/dev-common.sh"
require_cmd tmux
if check_session_exists; then
  attach_session
else
  print_error "no session '${TMUX_SESSION}'. Run bin/start-dev-docker.sh first."
  exit 1
fi
