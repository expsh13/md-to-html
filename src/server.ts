import fs from "node:fs/promises";
import http, { type Server, type ServerResponse } from "node:http";
import path from "node:path";

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
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const html: string[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let blockquote: string[] = [];
  let codeFence: string | null = null;
  let codeLines: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    html.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (listItems.length === 0) return;
    html.push(`<ul>${listItems.map((item) => `<li>${renderInline(item)}</li>`).join("")}</ul>`);
    listItems = [];
  };

  const flushBlockquote = () => {
    if (blockquote.length === 0) return;
    html.push(`<blockquote>${blockquote.map((line) => `<p>${renderInline(line)}</p>`).join("")}</blockquote>`);
    blockquote = [];
  };

  const flushTextBlocks = () => {
    flushParagraph();
    flushList();
    flushBlockquote();
  };

  for (const line of lines) {
    const fenceMatch = line.match(/^```(.*)$/);
    if (fenceMatch) {
      if (codeFence) {
        html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeFence = null;
        codeLines = [];
      } else {
        flushTextBlocks();
        codeFence = fenceMatch[1] || "plain";
      }
      continue;
    }

    if (codeFence) {
      codeLines.push(line);
      continue;
    }

    if (line.trim() === "") {
      flushTextBlocks();
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      flushTextBlocks();
      const level = headingMatch[1].length;
      const rawText = headingMatch[2].replace(/\s+#+\s*$/, "").trim();
      const text = stripMarkdown(rawText);
      const id = uniqueSlug(text, usedIds);
      headings.push({ id, level, text });
      html.push(`<h${level} id="${id}"><a class="heading-anchor" href="#${id}" aria-label="Link to ${escapeAttribute(text)}">${"#".repeat(level)}</a>${renderInline(rawText)}</h${level}>`);
      continue;
    }

    const listMatch = line.match(/^\s*[-*]\s+(.+)$/);
    if (listMatch) {
      flushParagraph();
      flushBlockquote();
      listItems.push(listMatch[1]);
      continue;
    }

    const blockquoteMatch = line.match(/^>\s?(.+)$/);
    if (blockquoteMatch) {
      flushParagraph();
      flushList();
      blockquote.push(blockquoteMatch[1]);
      continue;
    }

    flushList();
    flushBlockquote();
    paragraph.push(line.trim());
  }

  if (codeFence) {
    html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  }
  flushTextBlocks();

  return { content: html.join("\n"), headings };
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
  if (headings.length === 0) {
    return `<p class="toc-empty">No headings</p>`;
  }

  let html = "";
  const stack: number[] = [];

  for (const heading of headings) {
    while (stack.length > 0 && stack[stack.length - 1] >= heading.level) {
      html += "</li></ol>";
      stack.pop();
    }

    if (stack.length === 0 || stack[stack.length - 1] < heading.level) {
      html += `<ol class="toc-list level-${heading.level}">`;
      stack.push(heading.level);
    } else {
      html += "</li>";
    }

    html += `<li><a href="#${heading.id}" data-heading-id="${heading.id}">${escapeHtml(heading.text)}</a>`;
  }

  while (stack.length > 0) {
    html += "</li></ol>";
    stack.pop();
  }

  return html;
}

function renderInline(text: string): string {
  let escaped = escapeHtml(text);
  escaped = escaped.replace(/`([^`]+)`/g, "<code>$1</code>");
  escaped = escaped.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  escaped = escaped.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  escaped = escaped.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match: string, label: string, href: string) => {
    return `<a href="${escapeAttribute(href)}">${label}</a>`;
  });
  return escaped;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");
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

let isResizingToc = false;
let savedTocWidth = null;

try {
  savedTocWidth = localStorage.getItem("toc-width");
} catch {
  savedTocWidth = null;
}

if (savedTocWidth) {
  document.documentElement.style.setProperty("--toc-width", savedTocWidth + "px");
}

function applyTocWidth(clientX) {
  const width = Math.min(Math.max(clientX, 200), 520);
  document.documentElement.style.setProperty("--toc-width", width + "px");
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
  let parent = link.closest("ol")?.parentElement;
  while (parent && parent.matches("li")) {
    const parentLink = parent.querySelector(":scope > a");
    parentLink?.classList.add("active-parent");
    parent = parent.closest("ol")?.parentElement;
  }
}

function updateActiveHeading() {
  let current = headings[0];

  for (const heading of headings) {
    if (heading.getBoundingClientRect().top <= 120) {
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
  height: 100vh;
  overflow: auto;
  padding: 24px 18px;
  border-right: 1px solid var(--border);
  background: var(--toc-bg);
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

.toc-list .toc-list {
  margin-top: 2px;
  padding-left: 14px;
}

.toc li {
  margin: 2px 0;
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
