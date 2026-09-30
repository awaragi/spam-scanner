#!/usr/bin/env bash
# Shared tmux helpers for bin/start-dev-*.sh and friends.
#
#   SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
#   source "${SCRIPT_DIR}/lib/dev-common.sh"

DEV_COMMON_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${DEV_COMMON_LIB_DIR}/../.." && pwd)"

# Optional overrides (do not override vars already exported in the shell).
_dev_load_env_file() {
  local file="$1"
  [[ -f "${file}" ]] || return 0
  local line key value
  while IFS= read -r line || [[ -n "${line}" ]]; do
    [[ "${line}" =~ ^[[:space:]]*# ]] && continue
    [[ "${line}" =~ ^[[:space:]]*$ ]] && continue
    key="${line%%=*}"
    value="${line#*=}"
    [[ -z "${!key+x}" ]] && export "${key}=${value}"
  done < "${file}"
}
_dev_load_env_file "${REPO_ROOT}/bin/.env.local"
_dev_load_env_file "${REPO_ROOT}/bin/.env"

TMUX_SESSION="${SPAM_SCANNER_TMUX_SESSION:-spam-scanner-dev}"

print_status() {
  echo "-> $1"
}

print_error() {
  echo "error: $1" >&2
}

require_cmd() {
  local cmd="$1"
  local hint="${2:-}"
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    print_error "${cmd} is required but not found on PATH${hint:+ (${hint})}"
    exit 1
  fi
}

check_session_exists() {
  tmux has-session -t "${TMUX_SESSION}" 2>/dev/null
}

attach_session() {
  if [[ -n "${TMUX:-}" ]]; then
    tmux switch-client -t "${TMUX_SESSION}"
  else
    tmux attach-session -t "${TMUX_SESSION}"
  fi
}

kill_session_if_exists() {
  if check_session_exists; then
    print_status "Killing tmux session: ${TMUX_SESSION}"
    tmux kill-session -t "${TMUX_SESSION}"
  fi
}

# Stops bin/local/mock-rspamd.mjs whether it ran inside tmux or in the background.
# Matches the node process only (not Docker rspamd on the same port).
kill_mock_rspamd_process() {
  if ! command -v pgrep >/dev/null 2>&1; then
    print_status "pgrep not available - skipping mock rspamd process cleanup."
    return 0
  fi

  local pids
  pids=$(pgrep -f '[m]ock-rspamd\.mjs' 2>/dev/null || true)
  if [ -z "${pids}" ]; then
    return 0
  fi

  print_status "Stopping mock rspamd (PIDs: ${pids})..."
  # shellcheck disable=SC2086
  kill ${pids} 2>/dev/null || true

  local waited=0
  while [ "${waited}" -lt 10 ]; do
    pids=$(pgrep -f '[m]ock-rspamd\.mjs' 2>/dev/null || true)
    [ -z "${pids}" ] && return 0
    sleep 0.2
    waited=$((waited + 1))
  done

  print_status "Mock rspamd still running - sending SIGKILL."
  # shellcheck disable=SC2086
  kill -9 ${pids} 2>/dev/null || true
}

# If the session is already running, attach and exit (no second stack).
attach_or_exit_if_exists() {
  if ! check_session_exists; then
    return 0
  fi
  print_status "tmux session '${TMUX_SESSION}' already exists - attaching instead of restarting."
  print_status "(Run the matching bin/stop-dev-*.sh first if you want a clean restart.)"
  attach_session
  exit 0
}

pane_idx=0
pane_is_first=true

reset_pane_state() {
  pane_idx=0
  pane_is_first=true
}

# start_pane <title> <shell-command>
start_pane() {
  local title="$1"
  local cmd="$2"

  if [ "${pane_is_first}" = true ]; then
    tmux new-session -d -s "${TMUX_SESSION}" -n "dev"
    pane_is_first=false
  else
    tmux split-window -t "${TMUX_SESSION}:0"
    tmux select-layout -t "${TMUX_SESSION}:0" tiled >/dev/null
  fi

  tmux select-pane -t "${TMUX_SESSION}:0.${pane_idx}" -T "${title}"
  tmux send-keys -t "${TMUX_SESSION}:0.${pane_idx}" "${cmd}" C-m
  pane_idx=$((pane_idx + 1))
}

configure_session_layout() {
  tmux select-layout -t "${TMUX_SESSION}:0" tiled >/dev/null
  tmux set-option -g mouse on
  tmux set-option -g pane-border-status top
  tmux set-option -g pane-border-format "#{pane_title}"
}
