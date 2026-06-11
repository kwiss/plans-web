#!/usr/bin/env bun
// Micro static server for rendered plans (~/.claude/plans-web).
// Started on demand by plan-publish.ts; safe to run manually: `plan serve`.

import { readdirSync, statSync, readFileSync, existsSync } from "fs";
import { join, resolve, normalize } from "path";

const ROOT = resolve(import.meta.dir);
const PORT = Number(process.env.PLANS_PORT || 7878);

function pageShell(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
:root{color-scheme:light dark}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;max-width:880px;margin:0 auto;padding:2rem 1.5rem;line-height:1.6;background:light-dark(#fff,#0d1117);color:light-dark(#1f2328,#e6edf3)}
h1{font-size:1.5rem;border-bottom:1px solid light-dark(#d1d9e0,#30363d);padding-bottom:.5rem}
a{color:light-dark(#0969da,#4493f8);text-decoration:none}a:hover{text-decoration:underline}
ul{list-style:none;padding:0}
li{padding:.6rem .8rem;border:1px solid light-dark(#d1d9e0,#30363d);border-radius:8px;margin-bottom:.5rem;display:flex;justify-content:space-between;gap:1rem;align-items:baseline}
.meta{color:light-dark(#59636e,#9198a1);font-size:.85rem;white-space:nowrap}
</style></head><body>${body}</body></html>`;
}

function indexPage(): string {
  const files = readdirSync(ROOT)
    .filter((f) => f.endsWith(".html"))
    .map((f) => ({ name: f, mtime: statSync(join(ROOT, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  const items = files
    .map((f) => {
      let title = f.name;
      try {
        const m = readFileSync(join(ROOT, f.name), "utf8").match(/<title>(.*?)<\/title>/);
        if (m) title = m[1];
      } catch {}
      const date = new Date(f.mtime).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
      return `<li><a href="/${encodeURIComponent(f.name)}">${title}</a><span class="meta">${date}</span></li>`;
    })
    .join("\n");

  return pageShell("Plans", `<h1>📋 Plans (${files.length})</h1><ul>${items || "<li>No plans published yet.</li>"}</ul>`);
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/healthz") return new Response("ok");
    if (url.pathname === "/") return new Response(indexPage(), { headers: { "content-type": "text/html; charset=utf-8" } });

    // Static files, traversal-safe: resolve and require the path to stay in ROOT.
    const target = resolve(join(ROOT, normalize(decodeURIComponent(url.pathname))));
    if (!target.startsWith(ROOT + "/") || !existsSync(target) || !statSync(target).isFile()) {
      return new Response("not found", { status: 404 });
    }
    const ext = target.slice(target.lastIndexOf("."));
    return new Response(Bun.file(target), { headers: { "content-type": TYPES[ext] || "application/octet-stream" } });
  },
});

console.log(`plans-server listening on 0.0.0.0:${PORT}, serving ${ROOT}`);
