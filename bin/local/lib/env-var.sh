#!/usr/bin/env bash
# Shared helper for bin/local/*.sh scripts: reads one KEY=VALUE from the
# repo-root .env, falling back to an already-exported environment variable
# first, then to a caller-given default.
#
# Undoes the "$$" escaping .env needs for a literal "$" (docker-compose
# interpolates .env values wherever they're used, so an unescaped "$" starts
# what looks like a variable reference - see .env.example's RSPAMD_PASSWORD
# comment), so any value read this way round-trips correctly even if it
# contains "$".
#
# Requires the caller to have already set PROJECT_ROOT.
#
# Usage: value="$(read_env_var NAME [default])"
read_env_var() {
  local name="$1"
  local default_value="${2:-}"

  if [[ -n "${!name:-}" ]]; then
    echo "${!name}"
    return
  fi

  if [[ -f "${PROJECT_ROOT}/.env" ]]; then
    local value
    value="$(grep -E "^${name}=" "${PROJECT_ROOT}/.env" | tail -n1 | cut -d= -f2-)"
    value="${value//\$\$/\$}"
    if [[ -n "${value}" ]]; then
      echo "${value}"
      return
    fi
  fi

  echo "${default_value}"
}
