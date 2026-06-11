#!/bin/sh
# PreToolUse:Write hook — plans must be authored in HTML, not markdown.
# Denies writing .md files into project plan directories and tells the agent
# exactly what to do instead. The native Claude plan-mode file under
# ~/.claude/plans/ is exempt (the harness owns it; it gets auto-rendered).

INPUT=$(cat)
TOOL=$(printf '%s' "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)

deny() {
  cat <<'EOF'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Plans must be written in HTML, not markdown (plans-web rule). Do this instead: 1) scaffold with `plan template \"<Title>\" > <same-dir>/<slug>.html` (themed from the project DESIGN.md), 2) write the plan content as HTML sections inside <main>, 3) run `plan <file>.html` and give the user the URL."}}
EOF
  exit 0
}

if [ "$TOOL" = "Bash" ]; then
  # Catch shell-side plan writes too: redirects/tee into a plan-dir .md
  CMD=$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
  [ -z "$CMD" ] && exit 0
  case "$CMD" in
    *"$HOME/.claude/plans/"*) exit 0 ;;
  esac
  if printf '%s' "$CMD" | grep -qE "(>|>>|[[:space:]]tee[[:space:]]+(-a[[:space:]]+)?)[[:space:]]*[\"']?[^[:space:]\"']*(docs/(test-)?plans|\.cursor/plans|\.claude/plans|plans)/[^[:space:]\"']*\.(md|markdown)"; then
    deny
  fi
  exit 0
fi

FP=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
[ -z "$FP" ] && exit 0

case "$FP" in
  "$HOME/.claude/plans/"*) exit 0 ;;
esac

if printf '%s' "$FP" | grep -qiE '(^|/)(docs/(test-)?plans|\.cursor/plans|\.claude/plans|plans)/[^/]+\.(md|markdown)$'; then
  deny
fi
exit 0
