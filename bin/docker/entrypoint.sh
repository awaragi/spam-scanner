#!/bin/sh
set -e
set -u
set -o pipefail

exec node /app/src/orchestrator.js
