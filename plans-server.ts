#!/usr/bin/env bun
// Micro static server for rendered plans (~/.claude/plans-web).
// Started on demand by plan-publish.ts; safe to run manually: `plan serve`.
//
// Doc sources & the meta contract
// --------------------------------
// By default the index lists the *.html files sitting in this server's own dir
// (the flat global ~/.claude/plans-web bucket) — backward compatible.
//
// When PLANS_DOCS_DIRS is set (colon-separated absolute dirs), the index instead
// reads docs from those dirs, e.g. a repo's committed specs/plans:
//
//   PLANS_DOCS_DIRS="/abs/repo/docs/superpowers/specs:/abs/repo/docs/superpowers/plans"
//
// The global dir is always kept as a fallback bucket so loose global plans still
// show. Each doc HTML may carry two <head> meta tags (THE CONTRACT):
//
//   <meta name="doc-kind"   content="spec">   | "plan"
//   <meta name="doc-status" content="planned"> | "in-progress" | "implemented"
//
// Missing/unknown doc-status  -> treated as "planned".
// Missing/unknown doc-kind    -> inferred from the parent dir name ("specs"/"plans"),
//                                else "Other".

import { readdirSync, statSync, readFileSync, existsSync } from "fs";
import { join, resolve, normalize, basename } from "path";

const ROOT = resolve(import.meta.dir);
const PORT = Number(process.env.PLANS_PORT || 7878);

// Colon-separated absolute dirs of repo docs to serve. Empty when unset.
const DOCS_DIRS = (process.env.PLANS_DOCS_DIRS || "")
  .split(":")
  .map((d) => d.trim())
  .filter(Boolean)
  .map((d) => resolve(d))
  .filter((d) => existsSync(d) && statSync(d).isDirectory());

// ---------- meta contract ----------

type DocStatus = "planned" | "in-progress" | "implemented";
type DocKind = "spec" | "plan" | "other";

const STATUS_VALUES: readonly DocStatus[] = ["planned", "in-progress", "implemented"];
const KIND_VALUES: readonly DocKind[] = ["spec", "plan", "other"];

// Pull `content="..."` from a <meta name="<name>" ...> tag, attribute-order- and
// quote-agnostic, scanning only the <head>. Returns the lowercased value or null.
function readMeta(html: string, name: string): string | null {
  const head = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? html;
  const re = new RegExp(
    `<meta\\b[^>]*\\bname\\s*=\\s*["']${name}["'][^>]*>`,
    "i",
  );
  const tag = head.match(re)?.[0];
  if (!tag) return null;
  const content = tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i)?.[1];
  return content ? content.trim().toLowerCase() : null;
}

function readTitle(html: string, fallback: string): string {
  return html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim() || fallback;
}

function normalizeStatus(raw: string | null): DocStatus {
  return (STATUS_VALUES as readonly string[]).includes(raw ?? "")
    ? (raw as DocStatus)
    : "planned";
}

// Kind from meta, else inferred from the parent dir name, else "other".
function resolveKind(raw: string | null, dir: string): DocKind {
  if (raw && (KIND_VALUES as readonly string[]).includes(raw)) return raw as DocKind;
  const parent = basename(dir).toLowerCase();
  if (parent === "specs" || parent === "spec") return "spec";
  if (parent === "plans" || parent === "plan") return "plan";
  return "other";
}

const STATUS_LABEL: Record<DocStatus, string> = {
  planned: "Planned",
  "in-progress": "In progress",
  implemented: "Implemented",
};

const KIND_SECTION: Record<DocKind, { title: string; order: number }> = {
  spec: { title: "Specs", order: 0 },
  plan: { title: "Plans", order: 1 },
  other: { title: "Other", order: 2 },
};

// ---------- doc discovery ----------

type DocEntry = {
  name: string; // basename, used as the /<name> route key
  path: string; // absolute path on disk
  mtime: number;
  title: string;
  status: DocStatus;
  kind: DocKind;
};

// Build the route map (basename -> absolute path) and the listing. Repo doc dirs
// take precedence; the global dir is always appended as a fallback bucket. On a
// basename collision the first writer (repo dir) wins.
function collectDocs(): { entries: DocEntry[]; routes: Map<string, string> } {
  const routes = new Map<string, string>();
  const entries: DocEntry[] = [];
  // Repo dirs first, then the global dir as the fallback bucket.
  const dirs = [...DOCS_DIRS, ROOT];

  for (const dir of dirs) {
    let files: string[];
    try {
      files = readdirSync(dir).filter((f) => f.endsWith(".html"));
    } catch {
      continue;
    }
    for (const name of files) {
      if (routes.has(name)) continue; // earlier dir wins
      const path = join(dir, name);
      let html = "";
      try {
        html = readFileSync(path, "utf8");
      } catch {
        continue;
      }
      routes.set(name, path);
      entries.push({
        name,
        path,
        mtime: statSync(path).mtimeMs,
        title: readTitle(html, name),
        status: normalizeStatus(readMeta(html, "doc-status")),
        kind: resolveKind(readMeta(html, "doc-kind"), dir),
      });
    }
  }

  return { entries, routes };
}

// ---------- rendering ----------

function pageShell(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
:root{color-scheme:light dark}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;max-width:880px;margin:0 auto;padding:2rem 1.5rem;line-height:1.6;background:light-dark(#fff,#0d1117);color:light-dark(#1f2328,#e6edf3)}
h1{font-size:1.5rem;border-bottom:1px solid light-dark(#d1d9e0,#30363d);padding-bottom:.5rem}
h2{font-size:1.05rem;margin:1.8rem 0 .6rem;color:light-dark(#59636e,#9198a1);text-transform:uppercase;letter-spacing:.04em}
a{color:light-dark(#0969da,#4493f8);text-decoration:none}a:hover{text-decoration:underline}
ul{list-style:none;padding:0}
li{padding:.6rem .8rem;border:1px solid light-dark(#d1d9e0,#30363d);border-radius:8px;margin-bottom:.5rem;display:flex;justify-content:space-between;gap:1rem;align-items:baseline}
.left{display:flex;gap:.6rem;align-items:baseline;min-width:0}
.title{overflow:hidden;text-overflow:ellipsis}
.meta{color:light-dark(#59636e,#9198a1);font-size:.85rem;white-space:nowrap}
.status{font-size:.72rem;font-weight:600;padding:.1rem .5rem;border-radius:999px;white-space:nowrap;border:1px solid transparent}
.status-planned{background:light-dark(#eaeef2,#21262d);color:light-dark(#59636e,#9198a1);border-color:light-dark(#d1d9e0,#30363d)}
.status-in-progress{background:light-dark(#fff8c5,#3b2e0a);color:light-dark(#8a6d00,#e3b341);border-color:light-dark(#eac54f,#9e6a03)}
.status-implemented{background:light-dark(#dafbe1,#0f2f1a);color:light-dark(#1a7f37,#3fb950);border-color:light-dark(#aceebb,#2ea043)}
</style></head><body>${body}</body></html>`;
}

function statusPill(status: DocStatus): string {
  return `<span class="status status-${status}">${STATUS_LABEL[status]}</span>`;
}

function renderItem(d: DocEntry): string {
  const date = new Date(d.mtime).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
  return `<li><span class="left"><a class="title" href="/${encodeURIComponent(d.name)}">${d.title}</a>${statusPill(d.status)}</span><span class="meta">${date}</span></li>`;
}

function indexPage(): string {
  const { entries } = collectDocs();

  // Group by kind, newest-first inside each section.
  const byKind = new Map<DocKind, DocEntry[]>();
  for (const e of entries) {
    const arr = byKind.get(e.kind) ?? [];
    arr.push(e);
    byKind.set(e.kind, arr);
  }

  const sections = [...byKind.entries()]
    .sort((a, b) => KIND_SECTION[a[0]].order - KIND_SECTION[b[0]].order)
    .map(([kind, docs]) => {
      const items = docs
        .sort((a, b) => b.mtime - a.mtime)
        .map(renderItem)
        .join("\n");
      return `<h2>${KIND_SECTION[kind].title} (${docs.length})</h2><ul>${items}</ul>`;
    })
    .join("\n");

  const body = `<h1>📋 Plans (${entries.length})</h1>${
    sections || "<ul><li>No plans published yet.</li></ul>"
  }`;
  return pageShell("Plans", body);
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

// Resolve a request path to an on-disk file.
//  - /assets/* always serves from the server's own dir (css/js assets stay global).
//  - /<name>.html serves from whichever doc dir the file lives in (route map).
//  - anything else falls back to a traversal-safe lookup inside ROOT.
function resolveFile(pathname: string, routes: Map<string, string>): string | null {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^\/+/, "");

  // Assets stay global, traversal-safe against ROOT.
  if (rel.startsWith("assets/")) {
    const target = resolve(join(ROOT, rel));
    if (target.startsWith(ROOT + "/") && existsSync(target) && statSync(target).isFile()) {
      return target;
    }
    return null;
  }

  // Per-doc route: a bare basename mapped to its source dir.
  if (rel.endsWith(".html") && !rel.includes("/")) {
    const mapped = routes.get(rel);
    if (mapped && existsSync(mapped) && statSync(mapped).isFile()) return mapped;
  }

  // Fallback: traversal-safe lookup inside ROOT (legacy behavior).
  const target = resolve(join(ROOT, rel));
  if (target.startsWith(ROOT + "/") && existsSync(target) && statSync(target).isFile()) {
    return target;
  }
  return null;
}

Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/healthz") return new Response("ok");
    if (url.pathname === "/") return new Response(indexPage(), { headers: { "content-type": "text/html; charset=utf-8" } });

    // Route map is rebuilt per request so newly written docs are picked up.
    const { routes } = collectDocs();
    const target = resolveFile(url.pathname, routes);
    if (!target) return new Response("not found", { status: 404 });

    const ext = target.slice(target.lastIndexOf("."));
    return new Response(Bun.file(target), { headers: { "content-type": TYPES[ext] || "application/octet-stream" } });
  },
});

const dirsMsg = DOCS_DIRS.length ? `${DOCS_DIRS.join(", ")} + ${ROOT} (fallback)` : ROOT;
console.log(`plans-server listening on 0.0.0.0:${PORT}, serving ${dirsMsg}`);
