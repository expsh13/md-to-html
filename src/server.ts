import { watch, type FSWatcher } from "node:fs";
import fs from "node:fs/promises";
import http, { type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";

import { renderMarkdown } from "./markdown.ts";
import { renderPage } from "./page.ts";

export type StartServerOptions = {
  filePath: string;
  host: string;
  port: number;
};

export function startServer({ filePath, host, port }: StartServerOptions): Server {
  const absoluteFilePath = path.resolve(filePath);
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
