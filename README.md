# plans-web

**HTML-first plans.** Agents (Claude Code, Codex, …) write implementation plans directly in HTML — scaffolded by `plan template`, themed from the project's DESIGN.md — served by a micro Bun server, with a review URL handed back. A hook denies markdown plans in project plan dirs. Works locally and over Tailscale on remote servers.

## Install

```bash
npx -y github:kwiss/plans-web
```

Same command updates an existing install (git pull + re-run installer). Requires `bun` and `jq`. Manual fallback:

```bash
git clone https://github.com/kwiss/plans-web.git ~/.claude/plans-web && bash ~/.claude/plans-web/install.sh
```

The installer symlinks the `plan` command into `~/.local/bin` and wires Claude Code hooks (`ExitPlanMode` → publish + URL) into `~/.claude/settings.json`.

## How it works

- **HTML-first authoring**: `plan template "Title" > docs/plans/<slug>.html` scaffolds a themed standalone page; the agent writes the plan as HTML sections inside `<main>`, then `plan <file>.html` publishes it and prints the URL. The installer appends this rule to `~/.claude/CLAUDE.md` (and to the project `CLAUDE.md` with `--project`).
- **Enforcement**: a `PreToolUse:Write` hook denies `.md` plan files in `docs/plans/`, `docs/test-plans/`, `.cursor/plans/`, `plans/` — the deny reason tells the agent the exact HTML workflow to use instead.
- **Native Claude plan mode** (exception): the harness-owned plan file in `~/.claude/plans/*.md` stays markdown; hooks on `ExitPlanMode` render it to HTML at review time and emit the URL as a system message.
- **Codex / manual**: `plan <file.html|file.md>` → prints the URL. (`~/.codex/AGENTS.md` instructs Codex to author HTML plans.)
- **Server**: `plans-server.ts`, port `7878` (env `PLANS_PORT`), binds `0.0.0.0`, serves this directory with an index of all plans. Auto-started on demand; `plan serve` / `plan stop` for manual control.
- **URL host**: `localhost` locally; over SSH it auto-uses the Tailscale IP (override with `PLANS_HOST`).
- **Project theming**: if the project being planned has a `DESIGN.md` (or `design.md`, `docs/`, `.claude/`), labeled hex tokens (background / primary text / accent / border) and a font name are extracted and applied to the plan page in light mode. No design file → clean GitHub-style default.

## Per-project enforcement (team)

From inside a project repo:

```bash
npx -y github:kwiss/plans-web --project
git add .claude/settings.json && git commit
```

This wires the same hooks into the project's **committed** `.claude/settings.json`, so every dev's Claude Code publishes plans as HTML. Devs without plans-web installed see an install hint instead of a silent failure. The tool stays global and design-agnostic — project look & feel always comes from the project's own `DESIGN.md` at publish time, never from the tool.

## Commands

```bash
plan template "Title"   # print a themed HTML scaffold (write it to docs/plans/<slug>.html)
plan <file.html>        # publish an HTML plan as-is, print URL
plan <file.md>          # render a legacy markdown file to HTML, print URL
plan ls                 # list published plan URLs (newest first)
plan url                # base URL
plan serve              # run server in foreground
plan stop               # stop server
```

## Server firewall (Ubuntu + UFW + Tailscale)

```bash
sudo ufw allow in on tailscale0 to any port 7878 proto tcp
```
