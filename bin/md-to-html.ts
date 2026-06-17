#!/usr/bin/env node

import { parseStartOptions, usage } from "../src/cli.ts";
import { startServer } from "../src/server.ts";

const result = parseStartOptions(process.argv.slice(2));

if (result.kind === "help") {
  console.log(usage.join("\n"));
  process.exit(result.exitCode);
}

if (result.kind === "error") {
  console.error(result.message);
  process.exit(1);
}

startServer(result.options);
