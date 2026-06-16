import fs from "node:fs/promises";
import http, { type Server, type ServerResponse } from "node:http";
import path from "node:path";

import { type Heading, renderMarkdown } from "./markdown.ts";

type StartServerOptions = {
  filePath: string;
  host: string;
  port: number;
};

type RenderPageOptions = {
  title: string;
  content: string;
  headings: Heading[];
};

export function startServer({ filePath, host, port }: StartServerOptions): Server {
  const absoluteFilePath = path.resolve(filePath);

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `${host}:${port}`}`);

      if (url.pathname.startsWith("/assets/")) {
        await sendStaticFile(res, "assets", url.pathname.replace(/^\/assets\//, ""));
        return;
      }

      if (url.pathname.startsWith("/public/")) {
        await sendStaticFile(res, "public", url.pathname.replace(/^\/public\//, ""));
        return;
      }

      if (url.pathname !== "/") {
        send(res, 404, "text/plain; charset=utf-8", "Not Found");
        return;
      }

      const markdown = await fs.readFile(absoluteFilePath, "utf8");
      const document = renderMarkdown(markdown);
      send(
        res,
        200,
        "text/html; charset=utf-8",
        renderPage({
          title: path.basename(absoluteFilePath),
          ...document,
        }),
      );
    } catch (error) {
      send(
        res,
        500,
        "text/plain; charset=utf-8",
        error instanceof Error ? error.message : String(error),
      );
    }
  });

  server.listen(port, host, () => {
    console.log(`Serving ${absoluteFilePath}`);
    console.log(`http://${host}:${port}`);
  });

  return server;
}

function renderPage({ title, content, headings }: RenderPageOptions): string {
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <link rel="stylesheet" href="/public/style.css">
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
  <script src="/public/app.js"></script>
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

async function sendStaticFile(
  res: ServerResponse,
  root: string,
  relativePath: string,
): Promise<void> {
  const filePath = path.resolve(root, relativePath);
  const rootPath = path.resolve(root);

  if (!filePath.startsWith(rootPath + path.sep)) {
    send(res, 404, "text/plain; charset=utf-8", "Not Found");
    return;
  }

  const body = await fs.readFile(filePath);
  res.writeHead(200, { "Content-Type": contentType(filePath) });
  res.end(body);
}

function send(res: ServerResponse, status: number, type: string, body: string): void {
  res.writeHead(status, { "Content-Type": type });
  res.end(body);
}

function contentType(filePath: string): string {
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
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
