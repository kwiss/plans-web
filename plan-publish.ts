#!/usr/bin/env bun
// plan-publish — render a markdown plan to styled HTML in ~/.claude/plans-web,
// make sure the micro server is up, and print/emit the URL.
//
// Usage:
//   plan <file.md>        publish a specific markdown file, print URL
//   plan --from-hook      Claude Code hook mode: reads hook JSON on stdin,
//                         publishes the freshest plan file, emits {systemMessage}
//   plan serve            start the server in foreground
//   plan stop             stop the server
//   plan ls               list published plan URLs (newest first)
//   plan url              print the base URL
//
// Env: PLANS_PORT (default 7878), PLANS_HOST (overrides host detection)

import { readdirSync, statSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, resolve, basename } from "path";
import { homedir, hostname } from "os";

const WEB_DIR = resolve(homedir(), ".claude/plans-web");
const PLANS_DIR = resolve(homedir(), ".claude/plans");
const SERVER = join(WEB_DIR, "plans-server.ts");
const STATE = join(WEB_DIR, ".last-publish");
const LOG = join(WEB_DIR, "server.log");
const PORT = Number(process.env.PLANS_PORT || 7878);

// ---------- host / URL ----------

function detectHost(): string {
  if (process.env.PLANS_HOST) return process.env.PLANS_HOST;
  const remote = !!(process.env.SSH_CONNECTION || process.env.SSH_TTY);
  if (remote) {
    // Prefer the Tailscale IP: reachable from the laptop, never public.
    try {
      const out = Bun.spawnSync(["tailscale", "ip", "-4"]).stdout.toString().trim().split("\n")[0];
      if (/^\d+\.\d+\.\d+\.\d+$/.test(out)) return out;
    } catch {}
    return hostname();
  }
  return "localhost";
}

const baseUrl = () => `http://${detectHost()}:${PORT}`;

// ---------- server lifecycle ----------

async function serverUp(): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/healthz`, { signal: AbortSignal.timeout(400) });
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureServer(): Promise<void> {
  if (await serverUp()) return;
  const log = Bun.file(LOG);
  Bun.spawn(["bun", SERVER], {
    stdout: log,
    stderr: log,
    env: { ...process.env },
  }).unref();
  // Give it a beat, then re-check (best effort — don't block the hook).
  for (let i = 0; i < 10; i++) {
    await Bun.sleep(100);
    if (await serverUp()) return;
  }
}

// ---------- project theme (from DESIGN.md) ----------

type Theme = { bg?: string; text?: string; accent?: string; border?: string; font?: string };

function findDesignFile(cwd: string): string | null {
  if (!cwd) return null;
  for (const rel of ["DESIGN.md", "design.md", "docs/DESIGN.md", "docs/design.md", ".claude/DESIGN.md", ".claude/design.md"]) {
    const p = join(cwd, rel);
    if (existsSync(p)) return p;
  }
  return null;
}

// Light heuristic: find the first hex color on a line whose label matches the
// role. Works with token tables ("--cream | #F6EFDD | page canvas") as well as
// "primary: #xxx" prose. Anything we can't find just keeps the default style.
function extractTheme(designPath: string): Theme {
  let text = "";
  try {
    if (statSync(designPath).size > 200_000) return {};
    text = readFileSync(designPath, "utf8");
  } catch {
    return {};
  }
  const lines = text.split("\n");
  const HEX = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/;
  const grab = (label: RegExp): string | undefined => {
    for (const l of lines) {
      if (label.test(l)) {
        const m = l.match(HEX);
        if (m) return m[0];
      }
    }
  };
  const theme: Theme = {
    bg: grab(/page canvas|page bg|background/i),
    text: grab(/primary text|foreground|text color/i),
    accent: grab(/accent|brand|primary action|primary color|link/i),
    border: grab(/border/i),
  };
  const f = text.match(/font(?:-family)?[^:\n|]*[:|][\s`"']*([A-Za-z][A-Za-z0-9 _-]{2,40})/i);
  const fontName = f?.[1]?.trim();
  // Reject CSS keywords/functions the regex can catch ("var(--font-sans)" etc.)
  if (fontName && !/^(var|inherit|initial|unset|sans|serif|mono(space)?|system)$/i.test(fontName)) theme.font = fontName;
  return Object.fromEntries(Object.entries(theme).filter(([, v]) => v)) as Theme;
}

// Overrides apply in light mode only — a light-palette DESIGN.md forced onto
// dark mode produces unreadable combos. Accent rides along in both via border.
function themeCss(t: Theme): string {
  if (!Object.keys(t).length) return "";
  const rules: string[] = [];
  if (t.font) rules.push(`body{font-family:"${t.font}",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}`);
  const light: string[] = [];
  if (t.bg) light.push(`body{background:${t.bg}${t.text ? `;color:${t.text}` : ""}}`);
  if (t.accent) light.push(`a{color:${t.accent}} h1,h2{border-bottom-color:${t.accent}}`);
  if (t.border) light.push(`pre,th,td,header,blockquote{border-color:${t.border}}`);
  if (light.length) rules.push(`@media (prefers-color-scheme: light){${light.join("")}}`);
  return rules.length ? `<style>/* project theme */${rules.join("")}</style>` : "";
}

// ---------- rendering ----------

const BASE_CSS = `
:root{color-scheme:light dark}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;max-width:880px;margin:0 auto;padding:2rem 1.5rem;line-height:1.6;background:light-dark(#fff,#0d1117);color:light-dark(#1f2328,#e6edf3)}
header{display:flex;justify-content:space-between;align-items:baseline;gap:1rem;border-bottom:1px solid light-dark(#d1d9e0,#30363d);padding-bottom:.6rem;margin-bottom:1.5rem;font-size:.85rem;color:light-dark(#59636e,#9198a1)}
header a{color:inherit}
h1,h2,h3{line-height:1.3}
h1{font-size:1.7rem;border-bottom:1px solid light-dark(#d1d9e0,#30363d);padding-bottom:.4rem}
h2{font-size:1.35rem;margin-top:2rem;border-bottom:1px solid light-dark(#d1d9e0,#30363d);padding-bottom:.3rem}
a{color:light-dark(#0969da,#4493f8)}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.88em;background:light-dark(#f0f1f2,#1c2128);padding:.15em .4em;border-radius:5px}
pre{background:light-dark(#f6f8fa,#161b22)!important;border:1px solid light-dark(#d1d9e0,#30363d);border-radius:8px;padding:1rem;overflow-x:auto}
pre code{background:none;padding:0;font-size:.85rem}
table{border-collapse:collapse;width:100%;margin:1rem 0}
th,td{border:1px solid light-dark(#d1d9e0,#30363d);padding:.4rem .7rem;text-align:left}
th{background:light-dark(#f6f8fa,#161b22)}
blockquote{border-left:4px solid light-dark(#d1d9e0,#30363d);margin:0;padding:0 1rem;color:light-dark(#59636e,#9198a1)}
input[type=checkbox]{margin-right:.4rem}`;

function htmlHead(title: string, theme: Theme): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title.replace(/</g, "&lt;")}</title>
<link rel="stylesheet" href="/assets/github.min.css" media="(prefers-color-scheme: light)">
<link rel="stylesheet" href="/assets/github-dark.min.css" media="(prefers-color-scheme: dark)">
<style>${BASE_CSS}</style>
${themeCss(theme)}`;
}

function htmlHeader(project: string, date: string, themed: boolean): string {
  return `<header><span><a href="/">← plans</a> · ${project.replace(/</g, "&lt;")}${themed ? " · DESIGN.md" : ""}</span><span>${date}</span></header>`;
}

function htmlTemplate(md: string, title: string, project: string, date: string, theme: Theme = {}): string {
  // JSON-encode the markdown and break "</" so it can never terminate the <script>.
  const escaped = JSON.stringify(md).replace(/<\//g, "<\\/");
  const hasMermaid = md.includes("\`\`\`mermaid");
  return `${htmlHead(title, theme)}
<script src="/assets/marked.min.js"></script>
<script src="/assets/highlight.min.js"></script>
</head><body>
${htmlHeader(project, date, Object.keys(theme).length > 0)}
<main id="content"></main>
<script>
const md = ${escaped};
document.getElementById("content").innerHTML = marked.parse(md, { gfm: true, breaks: false });
document.querySelectorAll("pre code").forEach((el) => { try { hljs.highlightElement(el); } catch {} });
${hasMermaid ? `
// Mermaid blocks: lazy-load from CDN (only when the plan actually has diagrams).
document.querySelectorAll("code.language-mermaid").forEach((el) => {
  const div = document.createElement("pre");
  div.className = "mermaid";
  div.textContent = el.textContent;
  el.closest("pre").replaceWith(div);
});
import("https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs")
  .then((m) => m.default.run({ querySelector: ".mermaid" }))
  .catch(() => {});` : ""}
</script>
</body></html>`;
}

// HTML-first scaffold: agents WRITE the plan in HTML inside <main>.
// Theme comes from the current project's DESIGN.md at scaffold time.
function scaffold(title: string, project: string, date: string, theme: Theme): string {
  // The two meta tags below are THE CONTRACT the plans-web index reads:
  //   doc-status: "planned" | "in-progress" | "implemented"  (bump as work lands)
  //   doc-kind:   "spec" | "plan"                            (move to specs/ + flip to spec)
  return `${htmlHead(title, theme)}
<meta name="doc-status" content="planned">
<meta name="doc-kind" content="plan">
<script src="/assets/highlight.min.js"></script>
</head><body>
${htmlHeader(project, date, Object.keys(theme).length > 0)}
<main>
<h1>${title.replace(/</g, "&lt;")}</h1>

<section>
<h2>Context</h2>
<p><!-- why this plan exists, current state --></p>
</section>

<section>
<h2>Steps</h2>
<ol>
<li><!-- step --></li>
</ol>
</section>

<section>
<h2>Verification</h2>
<ul>
<li><!-- how we prove it works --></li>
</ul>
</section>

<!-- Add sections as needed (risks, files touched, rollout).
     Code samples: <pre><code class="language-ts">...</code></pre>
     Tables, lists, links: plain HTML. -->
</main>
<script>document.querySelectorAll("pre code").forEach((el)=>{try{hljs.highlightElement(el)}catch{}});</script>
</body></html>`;
}

function slugify(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "plan";
}

function publish(md: string, sourceName: string, projectDir: string): string {
  const title = md.match(/^#\s+(.+)$/m)?.[1]?.trim() || sourceName.replace(/\.md$/, "");
  const now = new Date();
  const stamp = now.toISOString().slice(0, 10);
  const file = `${stamp}-${slugify(title)}.html`;
  const date = now.toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
  const design = findDesignFile(projectDir);
  const theme = design ? extractTheme(design) : {};
  mkdirSync(WEB_DIR, { recursive: true });
  writeFileSync(join(WEB_DIR, file), htmlTemplate(md, title, basename(projectDir) || "plan", date, theme));
  return `${baseUrl()}/${file}`;
}

// ---------- plan discovery (hook mode) ----------

function newestPlanFile(maxAgeMin = 60): string | null {
  if (!existsSync(PLANS_DIR)) return null;
  const cutoff = Date.now() - maxAgeMin * 60_000;
  let best: { path: string; mtime: number } | null = null;
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".md")) {
        const m = statSync(p).mtimeMs;
        if (m > cutoff && (!best || m > best.mtime)) best = { path: p, mtime: m };
      }
    }
  };
  walk(PLANS_DIR);
  return best?.path ?? null;
}

// ---------- entry ----------

const arg = process.argv[2];

if (arg === "serve") {
  await import(SERVER);
} else if (arg === "stop") {
  Bun.spawnSync(["pkill", "-f", "plans-server.ts"]);
  console.log("plans-server stopped");
} else if (arg === "url") {
  console.log(baseUrl());
} else if (arg === "ls") {
  const files = readdirSync(WEB_DIR).filter((f) => f.endsWith(".html"))
    .map((f) => ({ f, m: statSync(join(WEB_DIR, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  for (const { f } of files) console.log(`${baseUrl()}/${f}`);
} else if (arg === "--from-hook") {
  // Never break Claude's flow: any failure exits 0 silently.
  try {
    let cwd = "";
    try {
      const input = JSON.parse(await Bun.stdin.text());
      cwd = input.cwd || "";
    } catch {}
    const planFile = newestPlanFile();
    if (!planFile) process.exit(0);
    const md = readFileSync(planFile, "utf8");

    // Dedupe: PreToolUse + PostToolUse both fire — only announce once per content.
    const hash = String(Bun.hash(md));
    if (existsSync(STATE) && readFileSync(STATE, "utf8") === hash) process.exit(0);

    await ensureServer();
    const url = publish(md, basename(planFile), cwd || process.cwd());
    writeFileSync(STATE, hash);
    console.log(JSON.stringify({ systemMessage: `📋 Plan HTML → ${url}` }));
  } catch {}
  process.exit(0);
} else if (arg === "template") {
  const title = process.argv[3] || "Implementation Plan";
  const design = findDesignFile(process.cwd());
  const theme = design ? extractTheme(design) : {};
  const date = new Date().toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
  console.log(scaffold(title, basename(process.cwd()), date, theme));
} else if (arg && existsSync(arg)) {
  await ensureServer();
  if (/\.html?$/.test(arg)) {
    // HTML-first plan: publish as-is.
    const html = readFileSync(arg, "utf8");
    const title = html.match(/<title>(.*?)<\/title>/)?.[1]
      || html.match(/<h1[^>]*>([^<]*)/)?.[1]?.trim()
      || basename(arg).replace(/\.html?$/, "");
    const file = `${new Date().toISOString().slice(0, 10)}-${slugify(title)}.html`;
    mkdirSync(WEB_DIR, { recursive: true });
    writeFileSync(join(WEB_DIR, file), html);
    console.log(`${baseUrl()}/${file}`);
  } else {
    const md = readFileSync(arg, "utf8");
    console.log(publish(md, basename(arg), process.cwd()));
  }
} else {
  console.log("usage: plan <file.html|file.md> | template [title] | serve | stop | ls | url | --from-hook");
  process.exit(arg ? 1 : 0);
}
