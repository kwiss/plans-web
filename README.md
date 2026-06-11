# plans-web

Markdown plans rendered as styled HTML, served by a micro Bun server, with a URL handed back at plan-review time. Works locally and over Tailscale on remote servers.

## Install

```bash
git clone git@github.com:kwiss/plans-web.git ~/.claude/plans-web
bash ~/.claude/plans-web/install.sh
```

Requires `bun` and `jq`. The installer symlinks the `plan` command into `~/.local/bin` and wires Claude Code hooks (`ExitPlanMode` → publish + URL) into `~/.claude/settings.json`.

## How it works

- **Claude Code**: hooks fire when a plan reaches review; the freshest `~/.claude/plans/*.md` is rendered to HTML here, the server is health-checked/auto-started, and the URL appears as a system message. Zero agent instructions, zero tokens.
- **Codex / manual**: `plan <file.md>` → prints the URL. (`~/.codex/AGENTS.md` instructs Codex to do this after writing a plan.)
- **Server**: `plans-server.ts`, port `7878` (env `PLANS_PORT`), binds `0.0.0.0`, serves this directory with an index of all plans. Auto-started on demand; `plan serve` / `plan stop` for manual control.
- **URL host**: `localhost` locally; over SSH it auto-uses the Tailscale IP (override with `PLANS_HOST`).
- **Project theming**: if the project being planned has a `DESIGN.md` (or `design.md`, `docs/`, `.claude/`), labeled hex tokens (background / primary text / accent / border) and a font name are extracted and applied to the plan page in light mode. No design file → clean GitHub-style default.

## Per-project enforcement (team)

From inside a project repo:

```bash
bash ~/.claude/plans-web/install.sh --project
git add .claude/settings.json && git commit
```

This wires the same hooks into the project's **committed** `.claude/settings.json`, so every dev's Claude Code publishes plans as HTML. Devs without plans-web installed see an install hint instead of a silent failure. The tool stays global and design-agnostic — project look & feel always comes from the project's own `DESIGN.md` at publish time, never from the tool.

## Commands

```bash
plan <file.md>   # publish a markdown file, print URL
plan ls          # list published plan URLs (newest first)
plan url         # base URL
plan serve       # run server in foreground
plan stop        # stop server
```

## Server firewall (Ubuntu + UFW + Tailscale)

```bash
sudo ufw allow in on tailscale0 to any port 7878 proto tcp
```
