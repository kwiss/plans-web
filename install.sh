#!/bin/bash
# plans-web installer — run from a clone at ~/.claude/plans-web.
# Sets up the `plan` command, the plans dir, and the Claude Code hooks.
# Idempotent: safe to re-run after git pull.
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"

# --project: run from inside a project repo. Wires the hooks into the
# project's committed .claude/settings.json so every dev on the repo gets
# plan → HTML. Devs without plans-web installed get an install hint instead
# of a silent failure. The tool itself stays global and design-agnostic —
# theming comes from the project's own DESIGN.md at publish time.
if [ "${1:-}" = "--project" ]; then
  command -v jq >/dev/null || { echo "jq is required"; exit 1; }
  PROJ_SETTINGS="$(pwd)/.claude/settings.json"
  mkdir -p "$(pwd)/.claude"
  [ -f "$PROJ_SETTINGS" ] || echo '{}' > "$PROJ_SETTINGS"
  if grep -q "plan-publish.ts" "$PROJ_SETTINGS"; then
    echo "hooks: already wired in $PROJ_SETTINGS"
    exit 0
  fi
  HOOK_CMD='if [ -f "$HOME/.claude/plans-web/plan-publish.ts" ]; then bun "$HOME/.claude/plans-web/plan-publish.ts" --from-hook; else echo "{\"systemMessage\":\"📋 plans-web missing — install it: git clone git@github.com:kwiss/plans-web.git ~/.claude/plans-web && bash ~/.claude/plans-web/install.sh\"}"; fi'
  tmp=$(mktemp)
  jq --arg cmd "$HOOK_CMD" '
    .hooks //= {} |
    .hooks.PreToolUse  = ([{matcher:"ExitPlanMode",hooks:[{type:"command",command:$cmd,timeout:15,statusMessage:"Publishing plan as HTML"}]}] + (.hooks.PreToolUse  // [])) |
    .hooks.PostToolUse = ([{matcher:"ExitPlanMode",hooks:[{type:"command",command:$cmd,timeout:15,statusMessage:"Publishing plan as HTML"}]}] + (.hooks.PostToolUse // []))
  ' "$PROJ_SETTINGS" > "$tmp" && mv "$tmp" "$PROJ_SETTINGS"
  echo "hooks: wired into $PROJ_SETTINGS — commit it so the whole team publishes plans as HTML"
  exit 0
fi

if [ "$DIR" != "$HOME/.claude/plans-web" ]; then
  echo "⚠️  expected to run from ~/.claude/plans-web (got $DIR)" >&2
  echo "   clone with: git clone git@github.com:kwiss/plans-web.git ~/.claude/plans-web" >&2
  exit 1
fi

command -v bun >/dev/null || { echo "bun is required (https://bun.sh)"; exit 1; }
command -v jq >/dev/null || { echo "jq is required"; exit 1; }

mkdir -p "$HOME/.local/bin" "$HOME/.claude/plans"
ln -sf "$DIR/bin/plan" "$HOME/.local/bin/plan"
chmod +x "$DIR/bin/plan"

# Wire Claude Code hooks (ExitPlanMode → publish + URL) unless already present.
SETTINGS="$HOME/.claude/settings.json"
HOOK_CMD='bun "$HOME/.claude/plans-web/plan-publish.ts" --from-hook'
[ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"
if grep -q "plan-publish.ts" "$SETTINGS"; then
  echo "hooks: already wired in $SETTINGS"
else
  tmp=$(mktemp)
  jq --arg cmd "$HOOK_CMD" '
    .hooks //= {} |
    .hooks.PreToolUse  = ([{matcher:"ExitPlanMode",hooks:[{type:"command",command:$cmd,timeout:15,statusMessage:"Publishing plan as HTML"}]}] + (.hooks.PreToolUse  // [])) |
    .hooks.PostToolUse = ([{matcher:"ExitPlanMode",hooks:[{type:"command",command:$cmd,timeout:15,statusMessage:"Publishing plan as HTML"}]}] + (.hooks.PostToolUse // []))
  ' "$SETTINGS" > "$tmp" && mv "$tmp" "$SETTINGS"
  echo "hooks: wired ExitPlanMode → plan-publish in $SETTINGS"
fi

echo "✅ installed. Try: plan url"
if [ "$(uname)" = "Linux" ] && command -v ufw >/dev/null; then
  echo "ℹ️  server note — open the port on Tailscale only:"
  echo "   sudo ufw allow in on tailscale0 to any port ${PLANS_PORT:-7878} proto tcp"
fi
