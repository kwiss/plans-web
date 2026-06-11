#!/bin/sh
# plans-web bootstrap — one-liner install/update:
#   npx -y github:kwiss/plans-web              # global setup (or update)
#   npx -y github:kwiss/plans-web --project    # wire hooks into the current repo
# Clones (or updates) the durable home at ~/.claude/plans-web, then installs.
set -e

DIR="$HOME/.claude/plans-web"

if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull --ff-only >/dev/null 2>&1 || true
elif command -v gh >/dev/null 2>&1; then
  gh repo clone kwiss/plans-web "$DIR" -- -q
else
  git clone -q git@github.com:kwiss/plans-web.git "$DIR"
fi

exec bash "$DIR/install.sh" "$@"
