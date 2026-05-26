#!/bin/sh
set -e
set -u
set -o pipefail

VERSION=$(node -p "require('/app/package.json').version")
echo "{\"level\":\"info\",\"time\":\"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\",\"component\":\"entrypoint\",\"version\":\"${VERSION}\",\"msg\":\"spam-scanner starting\"}"

exec node /app/src/orchestrator.js
