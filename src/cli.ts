import type { StartServerOptions } from "./server.js";

export type ParseStartOptionsResult =
  | {
      kind: "start";
      options: StartServerOptions;
    }
  | {
      kind: "help";
      exitCode: 0 | 1;
    }
  | {
      kind: "error";
      message: string;
    };

export const usage = [
  "Usage: md-live <file.md> [--port 4321] [--host 127.0.0.1]",
  "Example: pnpm start -- sample.md",
];

export function parseStartOptions(args: string[]): ParseStartOptionsResult {
  const normalizedArgs = args.filter((arg) => arg !== "--");

  if (normalizedArgs.length === 0) {
    return { kind: "help", exitCode: 1 };
  }

  if (normalizedArgs.includes("--help") || normalizedArgs.includes("-h")) {
    return { kind: "help", exitCode: 0 };
  }

  const filePath = readFilePath(normalizedArgs);
  const portValue = readOption(normalizedArgs, "--port");
  const host = readOption(normalizedArgs, "--host") ?? "127.0.0.1";
  const port = Number(portValue ?? 4321);

  if (!filePath) {
    return { kind: "error", message: "Markdown file path is required." };
  }

  if (!Number.isInteger(port) || port <= 0) {
    return { kind: "error", message: "Invalid --port value." };
  }

  return {
    kind: "start",
    options: { filePath, host, port },
  };
}

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function readFilePath(args: string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith("--")) {
      index += 1;
      continue;
    }
    return arg;
  }
  return undefined;
}
