#!/bin/bash
# Run a minimal HTTP mock of rspamd's controller (check + learn + ping).
# Use this instead of `bin/local/rspamd.sh up` when Docker rspamd is unavailable.
# Listens on 127.0.0.1:11334 by default — same as docker-compose.base.yml — so
# RSPAMD_URL=http://localhost:11334 in .env works unchanged.
#
# Usage (from anywhere):
#   bin/local/mock-rspamd.sh
#
# Optional env:
#   MOCK_RSPAMD_HOST   (default 127.0.0.1)
#   MOCK_RSPAMD_PORT   (default 11334)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

cd "${PROJECT_ROOT}"
exec node "${SCRIPT_DIR}/mock-rspamd.mjs"
