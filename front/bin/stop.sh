#!/usr/bin/env bash
# Stops any background `ng serve` started from this repo's front workspace
# (tmux pane, nohup, or another terminal). The Angular CLI retitles its
# process to "ng serve (<package name>)", so matching on "(front)" leaves an
# `ng serve` from an unrelated project alone.
set -euo pipefail

pids=$(pgrep -f '^ng serve \(front\)' 2>/dev/null || true)
if [ -z "${pids}" ]; then
  echo "-> No front dev server running."
  exit 0
fi

echo "-> Stopping front dev server (PIDs: ${pids//$'\n'/ })..."
# shellcheck disable=SC2086
kill ${pids} 2>/dev/null || true
