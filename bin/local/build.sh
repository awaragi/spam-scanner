#!/usr/bin/env bash
# build.sh - Build and export the spam-scanner Docker image.
#
# Usage:
#   ./build.sh [OPTIONS]
#
# Options:
#   --platform <arch>    Target platform (default: linux/amd64)
#   --tag <tag>          Docker image tag (default: spam-scanner:latest)
#   --output <path>      Local path for the exported .tar file (default: /tmp/spam-scanner.tar)
#   --help               Show this help message

set -euo pipefail

# ─── Defaults ────────────────────────────────────────────────────────────────
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

PLATFORM="linux/amd64"
IMAGE_TAG="spam-scanner:latest"
OUTPUT_FILE="/tmp/spam-scanner.tar"

# ─── Helpers ─────────────────────────────────────────────────────────────────
log()   { echo "[$(date '+%H:%M:%S')] $*"; }
error() { echo "[$(date '+%H:%M:%S')] ERROR: $*" >&2; }

usage() {
    cat <<EOF
build.sh - Build and export the spam-scanner Docker image.

Usage:
  ./build.sh [OPTIONS]

Options:
  --platform <arch>    Target platform (default: linux/amd64)
  --tag <tag>          Docker image tag (default: spam-scanner:latest)
  --output <path>      Local path for the exported .tar file (default: /tmp/spam-scanner.tar)
  --help               Show this help message
EOF
    exit 0
}

require_cmd() {
    if ! command -v "$1" &>/dev/null; then
        error "Required command '$1' not found. Please install it and retry."
        exit 1
    fi
}

# ─── Argument parsing ─────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --platform)     PLATFORM="${2:?'--platform requires a value'}";     shift 2 ;;
        --tag)          IMAGE_TAG="${2:?'--tag requires a value'}";         shift 2 ;;
        --output)       OUTPUT_FILE="${2:?'--output requires a value'}";    shift 2 ;;
        --help|-h)      usage ;;
        *) error "Unknown option: $1"; usage ;;
    esac
done

# ─── Preflight checks ─────────────────────────────────────────────────────────
require_cmd docker

# ─── Build ────────────────────────────────────────────────────────────────────
log "Building image '${IMAGE_TAG}' for ${PLATFORM}..."
docker buildx build \
    --platform "${PLATFORM}" \
    --tag "${IMAGE_TAG}" \
    --load \
    "${PROJECT_ROOT}"
log "Build complete."

# ─── Export ───────────────────────────────────────────────────────────────────
log "Exporting image to '${OUTPUT_FILE}'..."
docker save -o "${OUTPUT_FILE}" "${IMAGE_TAG}"
log "Export complete ($(du -sh "${OUTPUT_FILE}" | cut -f1))."

log "Done."
