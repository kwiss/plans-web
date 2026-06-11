#!/bin/sh
# plans-web bootstrap — one-liner install/update:
#   npx -y github:kwiss/plans-web              # global setup (or update)
#   npx -y github:kwiss/plans-web --project    # wire hooks into the current repo
# Clones (or updates) the durable home at ~/.claude/plans-web, then installs.
set -e

DIR="$HOME/.claude/plans-web"

if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull --ff-only >/dev/null 2>&1 || true
else
  git clone -q https://github.com/kwiss/plans-web.git "$DIR"
fi

exec bash "$DIR/install.sh" "$@"
