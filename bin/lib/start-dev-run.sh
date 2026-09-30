#!/usr/bin/env bash
# Shared launcher body for bin/start-dev-*.sh (requires dev-common.sh sourced first).
#
#   launch_dev_stack <rspamd-pane-title> <rspamd-shell-command>

launch_dev_stack() {
  local rspamd_title="$1"
  local rspamd_cmd="$2"

  require_cmd tmux "install tmux or start services manually"

  if [ ! -f "${REPO_ROOT}/.env" ]; then
    print_error ".env not found at ${REPO_ROOT}/.env"
    print_error "Copy server/.env.example values into a repo-root .env before starting."
    exit 1
  fi

  attach_or_exit_if_exists

  print_status "Building shared (server imports its dist)..."
  (cd "${REPO_ROOT}" && npm run build --workspace=shared)

  reset_pane_state

  start_pane "${rspamd_title}" "${rspamd_cmd}"
  start_pane "server" "cd '${REPO_ROOT}' && bin/local/server-dev.sh"
  start_pane "front" "cd '${REPO_ROOT}' && npm run front:start"

  configure_session_layout

  echo ""
  print_status "Dev stack starting in tmux session '${TMUX_SESSION}'."
  print_status "Stop with: bin/stop-dev-${DEV_STACK_KIND}.sh"

  tmux select-pane -t "${TMUX_SESSION}:0.0"
  attach_session
}
