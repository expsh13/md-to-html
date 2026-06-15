import fs from "node:fs/promises";
import http, { type Server, type ServerResponse } from "node:http";
import path from "node:path";
import MarkdownIt from "markdown-it";

type StartServerOptions = {
  filePath: string;
  host: string;
  port: number;
};

type Heading = {
  id: string;
  level: number;
  text: string;
};

type RenderMarkdownResult = {
  content: string;
  headings: Heading[];
};

type RenderPageOptions = RenderMarkdownResult & {
  title: string;
};

type MarkdownToken = {
  type: string;
  tag: string;
  content: string;
  children?: MarkdownToken[] | null;
  meta?: Record<string, string>;
  attrGet(name: string): string | null;
  attrSet(name: string, value: string): void;
};

const markdownRenderer = new MarkdownIt({
  html: false,
  linkify: false,
  typographer: false
});

markdownRenderer.renderer.rules.heading_open = (tokens, index, options, _env, self) => {
  const token = tokens[index] as MarkdownToken;
  const level = Number(token.tag.slice(1));
  const id = token.attrGet("id") ?? "";
  const text = token.meta?.headingText ?? "";
  const anchor = `<a class="heading-anchor" href="#${escapeAttribute(id)}" aria-label="Link to ${escapeAttribute(text)}">${"#".repeat(level)}</a>`;

  return self.renderToken(tokens, index, options) + anchor;
};

export function startServer({ filePath, host, port }: StartServerOptions): Server {
  const absoluteFilePath = path.resolve(filePath);

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `${host}:${port}`}`);

      if (url.pathname === "/style.css") {
        send(res, 200, "text/css; charset=utf-8", styles);
        return;
      }

      if (url.pathname === "/app.js") {
        send(res, 200, "text/javascript; charset=utf-8", clientScript);
        return;
      }

      if (url.pathname.startsWith("/assets/")) {
        await sendAsset(res, url.pathname);
        return;
      }

      if (url.pathname !== "/") {
        send(res, 404, "text/plain; charset=utf-8", "Not Found");
        return;
      }

      const markdown = await fs.readFile(absoluteFilePath, "utf8");
      const document = renderMarkdown(markdown);
      send(res, 200, "text/html; charset=utf-8", renderPage({
        title: path.basename(absoluteFilePath),
        ...document
      }));
    } catch (error) {
      send(res, 500, "text/plain; charset=utf-8", error instanceof Error ? error.message : String(error));
    }
  });

  server.listen(port, host, () => {
    console.log(`Serving ${absoluteFilePath}`);
    console.log(`http://${host}:${port}`);
  });

  return server;
}

export function renderMarkdown(markdown: string): RenderMarkdownResult {
  const headings: Heading[] = [];
  const usedIds = new Map<string, number>();
  const tokens = markdownRenderer.parse(markdown, {}) as MarkdownToken[];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "heading_open") continue;

    const inlineToken = tokens[index + 1];
    const level = Number(token.tag.slice(1));
    const text = headingText(inlineToken).trim();
    const id = uniqueSlug(text, usedIds);

    token.attrSet("id", id);
    token.meta = { ...token.meta, headingText: text };
    headings.push({ id, level, text });
  }

  return { content: markdownRenderer.renderer.render(tokens, markdownRenderer.options, {}), headings };
}

function renderPage({ title, content, headings }: RenderPageOptions): string {
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <aside class="toc">
    <div class="toc-title">${escapeHtml(title)}</div>
    <nav aria-label="Table of contents">
      ${renderToc(headings)}
    </nav>
  </aside>
  <div class="toc-resizer" aria-hidden="true"></div>
  <main>
    <article>
      ${content}
    </article>
  </main>
  <script src="/app.js"></script>
</body>
</html>`;
}

function renderToc(headings: Heading[]): string {
  const visibleHeadings = headings.filter((heading) => heading.level <= 3);

  if (visibleHeadings.length === 0) {
    return `<p class="toc-empty">No headings</p>`;
  }

  const items = visibleHeadings.map((heading) => {
    return `<li class="toc-item level-${heading.level}"><a href="#${heading.id}" data-heading-id="${heading.id}"><span class="toc-level">h${heading.level}</span>${escapeHtml(heading.text)}</a></li>`;
  });

  return `<ol class="toc-list">${items.join("")}</ol>`;
}

function headingText(token: MarkdownToken | undefined): string {
  if (!token) return "";
  if (token.children) {
    return token.children.map(headingText).join("");
  }
  if (["text", "code_inline", "html_inline"].includes(token.type)) {
    return token.content;
  }
  return token.type === "image" ? token.content : "";
}

function uniqueSlug(text: string, usedIds: Map<string, number>): string {
  const base = text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "heading";
  const count = usedIds.get(base) ?? 0;
  usedIds.set(base, count + 1);
  return count === 0 ? base : `${base}-${count + 1}`;
}

function send(res: ServerResponse, status: number, type: string, body: string): void {
  res.writeHead(status, { "Content-Type": type });
  res.end(body);
}

async function sendAsset(res: ServerResponse, pathname: string): Promise<void> {
  const relativePath = pathname.replace(/^\/assets\//, "");
  const assetPath = path.resolve("assets", relativePath);
  const assetsRoot = path.resolve("assets");

  if (!assetPath.startsWith(assetsRoot + path.sep)) {
    send(res, 404, "text/plain; charset=utf-8", "Not Found");
    return;
  }

  const body = await fs.readFile(assetPath);
  res.writeHead(200, { "Content-Type": contentType(assetPath) });
  res.end(body);
}

function contentType(filePath: string): string {
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) return "image/jpeg";
  if (filePath.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

const clientScript = `
const links = Array.from(document.querySelectorAll(".toc a[data-heading-id]"));
const resizer = document.querySelector(".toc-resizer");
const headings = links
  .map((link) => document.getElementById(link.dataset.headingId))
  .filter(Boolean);
const visibleHeadingLevels = new Set(["H1", "H2", "H3"]);
const activeHeadings = headings.filter((heading) => visibleHeadingLevels.has(heading.tagName));

let isResizingToc = false;
let savedTocWidth = null;

try {
  savedTocWidth = localStorage.getItem("toc-width");
} catch {
  savedTocWidth = null;
}

if (savedTocWidth) {
  applyTocWidth(Number(savedTocWidth));
}

function applyTocWidth(clientX) {
  const width = Math.min(Math.max(clientX, 0), 520);
  document.documentElement.style.setProperty("--toc-width", width + "px");
  document.body.classList.toggle("toc-closed", width <= 16);
  try {
    localStorage.setItem("toc-width", String(width));
  } catch {
    // Ignore storage failures; resizing still works for the current page.
  }
}

function startTocResize(event) {
  event.preventDefault();
  isResizingToc = true;
  document.body.classList.add("resizing-toc");
  if (event.pointerId !== undefined) {
    resizer.setPointerCapture(event.pointerId);
  }
}

function moveTocResize(event) {
  if (!isResizingToc) return;
  applyTocWidth(event.clientX);
}

function stopTocResize(event) {
  if (!isResizingToc) return;
  isResizingToc = false;
  document.body.classList.remove("resizing-toc");
  if (event.pointerId !== undefined && resizer.hasPointerCapture(event.pointerId)) {
    resizer.releasePointerCapture(event.pointerId);
  }
}

resizer?.addEventListener("pointerdown", startTocResize);
resizer?.addEventListener("mousedown", startTocResize);
window.addEventListener("pointermove", moveTocResize);
window.addEventListener("mousemove", moveTocResize);
window.addEventListener("pointerup", stopTocResize);
window.addEventListener("mouseup", stopTocResize);

function setActive(id) {
  document.querySelectorAll(".toc .active, .toc .active-parent").forEach((node) => {
    node.classList.remove("active", "active-parent");
  });

  const link = document.querySelector('.toc a[data-heading-id="' + CSS.escape(id) + '"]');
  if (!link) return;

  link.classList.add("active");
}

function updateActiveHeading() {
  let current = activeHeadings[0];
  const activeLine = Math.round(window.innerHeight * 0.38);

  for (const heading of activeHeadings) {
    if (heading.getBoundingClientRect().top <= activeLine) {
      current = heading;
    } else {
      break;
    }
  }

  if (current) setActive(current.id);
}

window.addEventListener("scroll", updateActiveHeading, { passive: true });
window.addEventListener("resize", updateActiveHeading);
updateActiveHeading();
`;

const styles = `
:root {
  color-scheme: light;
  --text: #202124;
  --muted: #667085;
  --border: #e4e7ec;
  --link: #2563eb;
  --active: #111827;
  --bg: #ffffff;
  --toc-bg: #f8fafc;
  --toc-width: 280px;
}

* {
  box-sizing: border-box;
}

html {
  scroll-behavior: smooth;
}

body {
  margin: 0;
  display: grid;
  grid-template-columns: var(--toc-width) 6px minmax(0, 1fr);
  min-height: 100vh;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  line-height: 1.7;
}

.toc {
  position: sticky;
  top: 0;
  min-width: 0;
  height: 100vh;
  overflow: auto;
  padding: 24px 18px;
  border-right: 1px solid var(--border);
  background: var(--toc-bg);
}

.toc-closed .toc {
  overflow: hidden;
  padding: 0;
  border-right: 0;
}

.toc-closed .toc > * {
  visibility: hidden;
}

.toc-resizer {
  position: sticky;
  top: 0;
  height: 100vh;
  cursor: col-resize;
  background: transparent;
}

.toc-resizer:hover,
body.resizing-toc .toc-resizer {
  background: #d0d5dd;
}

body.resizing-toc {
  cursor: col-resize;
  user-select: none;
}

.toc-title {
  margin-bottom: 16px;
  font-size: 14px;
  font-weight: 700;
  line-height: 1.4;
}

.toc-list {
  margin: 0;
  padding-left: 0;
  list-style: none;
}

.toc li {
  margin: 2px 0;
}

.toc-item.level-1,
.toc-item.level-2 {
  margin-top: 10px;
  padding-top: 8px;
}

.toc-item.level-1:first-child,
.toc-item.level-2:first-child {
  margin-top: 0;
  padding-top: 0;
}

.toc a {
  display: block;
  padding: 3px 6px;
  border-radius: 6px;
  color: var(--muted);
  text-decoration: none;
  font-size: 13px;
  line-height: 1.45;
}

.toc-level {
  display: inline-block;
  width: 24px;
  margin-right: 8px;
  color: #98a2b3;
  font-size: 11px;
  font-weight: 700;
}

.toc a:hover {
  color: var(--active);
  background: #eef2f7;
}

.toc a.active {
  color: var(--active);
  background: #e6edf8;
  font-weight: 700;
}

.toc a.active-parent {
  color: var(--active);
  font-weight: 600;
}

.toc-empty {
  color: var(--muted);
  font-size: 13px;
}

main {
  width: 100%;
  max-width: 920px;
  padding: 40px 48px 80px;
}

article {
  width: 100%;
}

h1,
h2,
h3,
h4,
h5,
h6 {
  position: relative;
  margin: 2em 0 0.7em;
  line-height: 1.25;
  scroll-margin-top: 24px;
}

h1 {
  margin-top: 1em;
  font-size: 2rem;
}

h2 {
  font-size: 1.55rem;
}

h3 {
  font-size: 1.25rem;
}

.heading-anchor {
  margin-right: 8px;
  color: var(--link);
  text-decoration: none;
  opacity: 0.75;
}

p,
ul,
blockquote,
pre {
  margin: 0 0 1.1em;
}

a {
  color: var(--link);
}

code {
  padding: 0.1em 0.3em;
  border-radius: 4px;
  background: #f2f4f7;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.92em;
}

pre {
  overflow: auto;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #f8fafc;
}

pre code {
  padding: 0;
  background: transparent;
}

blockquote {
  padding-left: 14px;
  border-left: 3px solid var(--border);
  color: #475467;
}

img {
  display: block;
  max-width: 100%;
  height: auto;
  margin: 0 0 1.1em;
  border: 1px solid var(--border);
  border-radius: 8px;
}

table {
  width: 100%;
  margin: 0 0 1.1em;
  border-collapse: collapse;
}

th,
td {
  padding: 8px 10px;
  border: 1px solid var(--border);
  text-align: left;
}

th {
  background: #f8fafc;
}

@media (max-width: 760px) {
  body {
    display: block;
  }

  .toc {
    position: relative;
    height: auto;
    max-height: 42vh;
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }

  .toc-resizer {
    display: none;
  }

  main {
    padding: 28px 20px 56px;
  }
}
`;
