#!/usr/bin/env bash
# Local dev stack in tmux: mock rspamd, Nest server, Angular UI.
#
# Usage: bin/start-dev-mock.sh
# Re-attach: bin/attach-dev-mock.sh
# Stop:      bin/stop-dev-mock.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export SPAM_SCANNER_TMUX_SESSION="${SPAM_SCANNER_TMUX_SESSION:-spam-scanner-dev-mock}"
export DEV_STACK_KIND=mock
# shellcheck source=lib/dev-common.sh
source "${SCRIPT_DIR}/lib/dev-common.sh"
# shellcheck source=lib/start-dev-run.sh
source "${SCRIPT_DIR}/lib/start-dev-run.sh"

launch_dev_stack "mock-rspamd" "cd '${REPO_ROOT}' && npm run mock-rspamd"
