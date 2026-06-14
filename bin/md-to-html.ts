#!/usr/bin/env node

import { startServer } from "../src/server.ts";

const args = process.argv.slice(2);

if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  console.log("Usage: md-to-html <file.md> [--port 4321] [--host 127.0.0.1]");
  process.exit(args.length === 0 ? 1 : 0);
}

const filePath = args[0];
const port = Number(readOption(args, "--port") ?? 4321);
const host = readOption(args, "--host") ?? "127.0.0.1";

if (!filePath) {
  console.error("Markdown file path is required.");
  process.exit(1);
}

if (!Number.isInteger(port) || port <= 0) {
  console.error("Invalid --port value.");
  process.exit(1);
}

startServer({ filePath, host, port });

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}
