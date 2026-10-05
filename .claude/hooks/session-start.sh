#!/bin/bash
# SessionStart hook for Claude Code cloud sessions (registered in .claude/settings.json).
#
# It gets the container ready to run this repository's checks:
#   - Node 24 on the PATH. The Angular CLI 22.2 needs Node 22.22.3+ or 24.15+, and the container can ship an older 22.
#   - PW_CHROMIUM_PATH, the Chromium that is already installed, because `playwright install` is not available there.
#   - the npm dependencies of web/, and the git hooks (pre-push and commit-msg).
#
# It is idempotent, and it does nothing outside a cloud session. A cloud session starts from a cached container, so
# `npm ci` runs only when package-lock.json has changed since the last install.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

project_dir="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
env_file="${CLAUDE_ENV_FILE:-}"

# Adds a line to the session's environment file, once, so that running the hook again does not repeat it.
persist() {
  [ -n "$env_file" ] || return 0
  grep -qxF -- "$1" "$env_file" 2>/dev/null || printf '%s\n' "$1" >>"$env_file"
}

# True when version $1 is at least version $2, both like 24.15.0.
at_least() {
  [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n 1)" = "$2" ]
}

# True when the node at path $1 satisfies the "engines" of web/package.json: ^22.22.3 || >=24.15.0.
node_ok() {
  local version
  version="$("$1" --version 2>/dev/null)" || return 1
  version="${version#v}"
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || return 1
  case "${version%%.*}" in
    22) at_least "$version" 22.22.3 ;;
    23) return 1 ;;
    *) at_least "$version" 24.15.0 ;;
  esac
}

# The directory of a Node that an earlier `npx -y node@24` left in the npm cache, if one satisfies the engines.
cached_node_dir() {
  local candidate
  for candidate in "${HOME:-/nonexistent}"/.npm/_npx/*/node_modules/node/bin/node; do
    if [ -x "$candidate" ] && node_ok "$candidate"; then
      dirname "$candidate"
      return 0
    fi
  done
  return 1
}

# --- Node ------------------------------------------------------------------------------------------------------------
current_node="$(command -v node || true)"
if [ -z "$current_node" ] || ! node_ok "$current_node"; then
  node_dir="$(cached_node_dir || true)"
  if [ -z "$node_dir" ]; then
    # Fills the npx cache with Node 24. The folder it makes has a hash in its name, so look for it afterwards.
    npx -y node@24 --version >/dev/null 2>&1 || true
    node_dir="$(cached_node_dir || true)"
  fi
  if [ -n "$node_dir" ]; then
    export PATH="$node_dir:$PATH"
    persist "export PATH=\"$node_dir:\$PATH\""
  else
    echo "WARNING: no Node that satisfies 22.22.3+ or 24.15+ was found, and Node 24 could not be fetched." >&2
  fi
fi

# --- Chromium for Playwright -----------------------------------------------------------------------------------------
browsers="${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}"
chromium="$(ls -d "$browsers"/chromium-*/chrome-linux/chrome 2>/dev/null | sort -V | tail -n 1 || true)"
if [ -n "$chromium" ] && [ -x "$chromium" ]; then
  export PW_CHROMIUM_PATH="$chromium"
  persist "export PW_CHROMIUM_PATH=\"$chromium\""
else
  echo "WARNING: no Chromium found under $browsers, so the end-to-end tests have no browser (PW_CHROMIUM_PATH)." >&2
fi

# --- npm dependencies and git hooks ----------------------------------------------------------------------------------
dependencies="not installed"
if [ -z "${RMQ_SESSION_START_SKIP_INSTALL:-}" ] && [ -f "$project_dir/web/package-lock.json" ]; then
  cd "$project_dir/web"
  stamp="node_modules/.lockfile-sha256"
  wanted="$(sha256sum package-lock.json | cut -d ' ' -f 1)"
  if [ -d node_modules ] && [ "$(cat "$stamp" 2>/dev/null || true)" = "$wanted" ]; then
    dependencies="up to date"
  else
    npm ci --no-audit --no-fund >&2
    printf '%s\n' "$wanted" >"$stamp"
    dependencies="installed"
  fi
  # `npm ci` installs the git hooks too, but not when CI is set. Doing it again is cheap and changes nothing.
  node_modules/.bin/lefthook install >/dev/null 2>&1 || true
fi

node_version="$(node --version 2>/dev/null || echo 'not found')"
echo "Session ready: node ${node_version}, Chromium ${PW_CHROMIUM_PATH:-not found}, web/ dependencies ${dependencies}."
