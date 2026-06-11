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
  HOOK_CMD='if [ -f "$HOME/.claude/plans-web/plan-publish.ts" ]; then bun "$HOME/.claude/plans-web/plan-publish.ts" --from-hook; else echo "{\"systemMessage\":\"📋 plans-web missing — install it: npx -y github:kwiss/plans-web\"}"; fi'
  HOOK_ENFORCE='[ -f "$HOME/.claude/plans-web/hooks/enforce-html-plans.sh" ] && sh "$HOME/.claude/plans-web/hooks/enforce-html-plans.sh" || true'
  tmp=$(mktemp)
  jq --arg cmd "$HOOK_CMD" --arg enf "$HOOK_ENFORCE" '
    .hooks //= {} |
    .hooks.PreToolUse  = ([
      {matcher:"ExitPlanMode",hooks:[{type:"command",command:$cmd,timeout:15,statusMessage:"Publishing plan as HTML"}]},
      {matcher:"Write|Bash",hooks:[{type:"command",command:$enf,timeout:10,statusMessage:"Checking plan format"}]}
    ] + (.hooks.PreToolUse  // [])) |
    .hooks.PostToolUse = ([{matcher:"ExitPlanMode",hooks:[{type:"command",command:$cmd,timeout:15,statusMessage:"Publishing plan as HTML"}]}] + (.hooks.PostToolUse // []))
  ' "$PROJ_SETTINGS" > "$tmp" && mv "$tmp" "$PROJ_SETTINGS"
  echo "hooks: wired into $PROJ_SETTINGS — commit it so the whole team publishes plans as HTML"

  # Project CLAUDE.md instruction block (idempotent, marker-delimited)
  PROJ_MD="$(pwd)/CLAUDE.md"
  if ! grep -q "plans-web:start" "$PROJ_MD" 2>/dev/null; then
    cat >> "$PROJ_MD" <<'BLOCK'

<!-- plans-web:start -->
## Plans → HTML (plans-web)

Implementation plans are written in **HTML, not markdown** (a hook denies `.md` plans in `docs/plans/`, `.cursor/plans/`, `plans/`). Workflow:

1. `plan template "Title" > docs/plans/<slug>.html` — scaffold, auto-themed from the project DESIGN.md
2. Write the plan as HTML sections inside `<main>`
3. `plan <file>.html` → give the user the URL

Exception: the native Claude plan-mode file (`~/.claude/plans/*.md`) stays markdown — it is auto-rendered to HTML at review time.
<!-- plans-web:end -->
BLOCK
    echo "instructions: appended plans-web block to $PROJ_MD — commit it"
  fi
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

# Wire Claude Code hooks unless already present:
#   ExitPlanMode → render native plan-mode md + URL
#   Write        → deny markdown plans in project plan dirs (HTML-first)
SETTINGS="$HOME/.claude/settings.json"
HOOK_CMD='bun "$HOME/.claude/plans-web/plan-publish.ts" --from-hook'
HOOK_ENFORCE='sh "$HOME/.claude/plans-web/hooks/enforce-html-plans.sh"'
[ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"
if grep -q "plan-publish.ts" "$SETTINGS"; then
  echo "hooks: ExitPlanMode already wired in $SETTINGS"
else
  tmp=$(mktemp)
  jq --arg cmd "$HOOK_CMD" '
    .hooks //= {} |
    .hooks.PreToolUse  = ([{matcher:"ExitPlanMode",hooks:[{type:"command",command:$cmd,timeout:15,statusMessage:"Publishing plan as HTML"}]}] + (.hooks.PreToolUse  // [])) |
    .hooks.PostToolUse = ([{matcher:"ExitPlanMode",hooks:[{type:"command",command:$cmd,timeout:15,statusMessage:"Publishing plan as HTML"}]}] + (.hooks.PostToolUse // []))
  ' "$SETTINGS" > "$tmp" && mv "$tmp" "$SETTINGS"
  echo "hooks: wired ExitPlanMode → plan-publish in $SETTINGS"
fi
if grep -q "enforce-html-plans" "$SETTINGS"; then
  echo "hooks: HTML-plan enforcement already wired in $SETTINGS"
else
  tmp=$(mktemp)
  jq --arg enf "$HOOK_ENFORCE" '
    .hooks //= {} |
    .hooks.PreToolUse = ([{matcher:"Write|Bash",hooks:[{type:"command",command:$enf,timeout:10,statusMessage:"Checking plan format"}]}] + (.hooks.PreToolUse // []))
  ' "$SETTINGS" > "$tmp" && mv "$tmp" "$SETTINGS"
  echo "hooks: wired Write → enforce-html-plans in $SETTINGS"
fi

# Global CLAUDE.md instruction block (idempotent, marker-delimited)
GLOBAL_MD="$HOME/.claude/CLAUDE.md"
if ! grep -q "plans-web:start" "$GLOBAL_MD" 2>/dev/null; then
  cat >> "$GLOBAL_MD" <<'BLOCK'

<!-- plans-web:start -->
## Plans → HTML (plans-web)

Implementation plans are written in **HTML, not markdown** (a hook denies `.md` plans in `docs/plans/`, `.cursor/plans/`, `plans/`). Workflow:

1. `plan template "Title" > docs/plans/<slug>.html` — scaffold, auto-themed from the project DESIGN.md
2. Write the plan as HTML sections inside `<main>`
3. `plan <file>.html` → give the user the URL

Exception: the native Claude plan-mode file (`~/.claude/plans/*.md`) stays markdown — it is auto-rendered to HTML at review time.
<!-- plans-web:end -->
BLOCK
  echo "instructions: appended plans-web block to $GLOBAL_MD"
fi

echo "✅ installed. Try: plan url"
if [ "$(uname)" = "Linux" ] && command -v ufw >/dev/null; then
  echo "ℹ️  server note — open the port on Tailscale only:"
  echo "   sudo ufw allow in on tailscale0 to any port ${PLANS_PORT:-7878} proto tcp"
fi
