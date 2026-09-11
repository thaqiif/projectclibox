#!/usr/bin/env node

import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { once } from "node:events";
import { join } from "node:path";
import { spawn } from "node:child_process";
import os from "node:os";
import process from "node:process";
import { performance } from "node:perf_hooks";

const args = parseArgs(process.argv.slice(2));
const runs = integerArg(args.runs, 5);
const firstPort = integerArg(args.port, 3121);
const cliwebRoot = join(process.cwd(), "cliweb");

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

function integerArg(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function quantiles(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
  return {
    n: sorted.length,
    min: sorted[0],
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: sorted.at(-1),
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttp(url, timeoutMs = 30000) {
  const started = performance.now();
  const deadline = started + timeoutMs;
  let lastError = null;
  while (performance.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        await response.arrayBuffer();
        return performance.now() - started;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(25);
  }
  throw new Error(`server did not become ready: ${lastError instanceof Error ? lastError.message : lastError}`);
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  await Promise.race([
    once(child, "exit"),
    sleep(5000),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

async function runOnce(port, index) {
  const tempRoot = mkdtempSync("/tmp/projectclibox-startup.");
  const home = join(tempRoot, "home");
  const nanobrew = join(tempRoot, "nanobrew");
  const tmux = join(tempRoot, "tmux");
  mkdirSync(home);
  mkdirSync(nanobrew);
  mkdirSync(tmux);
  const env = {
    ...process.env,
    TURBOPACK: undefined,
    TMUX: undefined,
    TMUX_PANE: undefined,
    HOME: home,
    DB_PATH: join(home, "cliweb.db"),
    CLIWEB_HOME: join(home, ".cliweb"),
    CLIWEB_NANOBREW_ROOT: nanobrew,
    TMUX_TMPDIR: tmux,
    SHELL: "/bin/bash",
    USER: "cliweb",
    LOGNAME: "cliweb",
    NODE_ENV: "production",
    PORT: String(port),
    CLIWEB_PORT: String(port),
    PATH: "/usr/local/bin:/usr/bin:/bin",
  };
  const child = spawn(process.execPath, ["node_modules/.bin/tsx", "server.ts"], {
    cwd: cliwebRoot,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  try {
    const elapsedMs = await waitForHttp(`http://127.0.0.1:${port}/`);
    return { index, port, elapsedMs, stderr: stderr.trim() || undefined };
  } finally {
    await stopProcess(child);
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function main() {
  const results = [];
  for (let i = 0; i < runs; i += 1) {
    results.push(await runOnce(firstPort + i, i + 1));
  }
  process.stdout.write(`${JSON.stringify({
    started: new Date().toISOString(),
    host: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpus: os.cpus().length,
      memoryMiB: os.totalmem() / 1024 / 1024,
    },
    config: {
      runs,
      firstPort,
      command: "node node_modules/.bin/tsx server.ts",
      build: "existing cliweb/.next production build",
    },
    runs: results,
    readyLatencyMs: quantiles(results.map((result) => result.elapsedMs)),
    finished: new Date().toISOString(),
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
