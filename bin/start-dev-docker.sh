#!/usr/bin/env bash
# Local dev stack in tmux: Docker rspamd (bin/local/rspamd.sh), server, front.
#
# Usage: bin/start-dev-docker.sh
# Re-attach: bin/attach-dev-docker.sh
# Stop:      bin/stop-dev-docker.sh (also runs rspamd compose down)
#
# Expect RSPAMD_URL in .env to match the local compose stack (default port 11334).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export SPAM_SCANNER_TMUX_SESSION="${SPAM_SCANNER_TMUX_SESSION:-spam-scanner-dev-docker}"
export DEV_STACK_KIND=docker
# shellcheck source=lib/dev-common.sh
source "${SCRIPT_DIR}/lib/dev-common.sh"
# shellcheck source=lib/start-dev-run.sh
source "${SCRIPT_DIR}/lib/start-dev-run.sh"

require_cmd docker "start Docker or use bin/start-dev-mock.sh instead"

launch_dev_stack \
  "rspamd" \
  "cd '${REPO_ROOT}' && bin/local/rspamd.sh up && bin/local/rspamd.sh logs"
