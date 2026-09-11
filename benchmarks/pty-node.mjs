#!/usr/bin/env node

import { createRequire } from "node:module";
import process from "node:process";
import { performance } from "node:perf_hooks";

const require = createRequire(import.meta.url);
const { spawn } = require("../cliweb/node_modules/node-pty");
const args = parseArgs(process.argv.slice(2));
const count = numberArg(args.count, 50);
const holdMs = numberArg(args["hold-ms"], 5000);

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      result[key] = argv[i + 1] && !argv[i + 1].startsWith("--")
        ? argv[++i]
        : true;
    }
  }
  return result;
}

function numberArg(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

const started = performance.now();
const terminals = [];
for (let i = 0; i < count; i += 1) {
  const terminal = spawn("/bin/bash", ["-i"], {
    name: "xterm-256color",
    cols: 80,
    rows: 24,
    cwd: process.cwd(),
    env: process.env,
  });
  terminal.onData(() => {});
  terminals.push(terminal);
}
const spawnMs = performance.now() - started;
await new Promise((resolve) => setTimeout(resolve, holdMs));
for (const terminal of terminals) terminal.kill();
console.log(JSON.stringify({
  count,
  spawnMs,
  holdMs,
  binary: "Node + node-pty + /bin/bash",
}));
