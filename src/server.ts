import { watch, type FSWatcher } from "node:fs";
import fs from "node:fs/promises";
import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderMarkdown } from "./markdown.js";
import { renderPage, renderToc } from "./page.js";

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageRoot =
  path.basename(path.dirname(moduleDirectory)) === "dist"
    ? path.resolve(moduleDirectory, "../..")
    : path.resolve(moduleDirectory, "..");
const maxSourceBytes = 5 * 1024 * 1024;

export type StartServerOptions = {
  filePath: string;
  host: string;
  port: number;
};

export function startServer({ filePath, host, port }: StartServerOptions): Server {
  const absoluteFilePath = path.resolve(filePath);
  const expectedOrigin = `http://${host}:${port}`;
  const reloadClients = new Set<ServerResponse>();
  const watcher = watchMarkdownFile(absoluteFilePath, () => {
    broadcastReload(reloadClients);
  });

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `${host}:${port}`}`);

      if (url.pathname === "/events") {
        sendEvents(req, res, reloadClients);
        return;
      }

      if (url.pathname === "/source") {
        await handleSource(req, res, absoluteFilePath, expectedOrigin);
        return;
      }

      if (url.pathname === "/content") {
        await handleContent(res, absoluteFilePath);
        return;
      }

      if (url.pathname.startsWith("/assets/")) {
        await sendStaticFile(
          res,
          [path.join(path.dirname(absoluteFilePath), "assets"), path.join(packageRoot, "assets")],
          url.pathname.replace(/^\/assets\//, ""),
        );
        return;
      }

      if (url.pathname.startsWith("/public/")) {
        await sendStaticFile(
          res,
          [path.join(packageRoot, "public")],
          url.pathname.replace(/^\/public\//, ""),
        );
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

  server.on("close", () => {
    watcher.close();
    for (const client of reloadClients) {
      client.end();
    }
    reloadClients.clear();
  });

  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(`Address already in use: http://${host}:${port}`);
      console.error("Stop the existing server or choose another port with --port.");
    } else {
      console.error(error.message);
    }
    process.exit(1);
  });

  server.listen(port, host, () => {
    console.log(`Serving ${absoluteFilePath}`);
    console.log(`http://${host}:${port}`);
  });

  return server;
}

function sendEvents(
  req: IncomingMessage,
  res: ServerResponse,
  reloadClients: Set<ServerResponse>,
): void {
  res.writeHead(200, {
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream",
    "X-Accel-Buffering": "no",
  });
  res.write(": connected\n\n");
  reloadClients.add(res);

  req.on("close", () => {
    reloadClients.delete(res);
  });
}

function watchMarkdownFile(filePath: string, onChange: () => void): FSWatcher {
  let timer: NodeJS.Timeout | undefined;
  let lastMtimeMs: number | undefined;

  return watch(filePath, () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const stats = await fs.stat(filePath);
        if (stats.mtimeMs === lastMtimeMs) return;
        lastMtimeMs = stats.mtimeMs;
        onChange();
      } catch {
        // Ignore transient states while editors rewrite the file.
      }
    }, 120);
  });
}

function broadcastReload(reloadClients: Set<ServerResponse>): void {
  const payload = `event: reload\ndata: ${Date.now()}\n\n`;
  for (const client of reloadClients) {
    client.write(payload);
  }
}

export async function handleSource(
  req: IncomingMessage,
  res: ServerResponse,
  filePath: string,
  expectedOrigin?: string,
): Promise<void> {
  if (req.method === "GET") {
    const markdown = await fs.readFile(filePath, "utf8");
    send(res, 200, "text/markdown; charset=utf-8", markdown);
    return;
  }

  if (req.method === "PUT") {
    if (!isAllowedOrigin(req, expectedOrigin)) {
      send(res, 403, "text/plain; charset=utf-8", "Forbidden");
      return;
    }

    const markdown = await readRequestBody(req, maxSourceBytes);
    await fs.writeFile(filePath, markdown, "utf8");
    send(res, 204, "text/plain; charset=utf-8", "");
    return;
  }

  res.writeHead(405, {
    Allow: "GET, PUT",
    "Content-Type": "text/plain; charset=utf-8",
    ...securityHeaders(),
  });
  res.end("Method Not Allowed");
}

export async function handleContent(res: ServerResponse, filePath: string): Promise<void> {
  const markdown = await fs.readFile(filePath, "utf8");
  const document = renderMarkdown(markdown);
  send(
    res,
    200,
    "application/json; charset=utf-8",
    JSON.stringify({
      content: document.content,
      toc: renderToc(document.headings),
    }),
  );
}

function isAllowedOrigin(req: IncomingMessage, expectedOrigin?: string): boolean {
  const origin = req.headers.origin;
  return !origin || !expectedOrigin || origin === expectedOrigin;
}

async function readRequestBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maxBytes) {
      throw new Error(`Request body is too large. Max size is ${maxBytes} bytes.`);
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function sendStaticFile(
  res: ServerResponse,
  roots: string[],
  relativePath: string,
): Promise<void> {
  for (const root of roots) {
    const filePath = path.resolve(root, relativePath);
    const rootPath = path.resolve(root);

    if (!filePath.startsWith(rootPath + path.sep)) {
      continue;
    }

    try {
      const body = await fs.readFile(filePath);
      res.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": contentType(filePath),
        ...securityHeaders(),
      });
      res.end(body);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  send(res, 404, "text/plain; charset=utf-8", "Not Found");
}

function send(res: ServerResponse, status: number, type: string, body: string): void {
  res.writeHead(status, { "Content-Type": type, ...securityHeaders() });
  res.end(body);
}

function securityHeaders(): Record<string, string> {
  return {
    "Content-Security-Policy":
      "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data: http: https:",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  };
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
