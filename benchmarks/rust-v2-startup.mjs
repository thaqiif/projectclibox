#!/usr/bin/env node

import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { once } from "node:events";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import os from "node:os";
import process from "node:process";
import { performance } from "node:perf_hooks";

const args = parseArgs(process.argv.slice(2));
const runs = integerArg(args.runs, 5);
const firstPort = integerArg(args.port, 3221);
const binary = resolve(String(args.binary ?? "target/release/projectclibox"));
const staticDir = resolve(String(args["static-dir"] ?? "frontend/dist"));

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token.startsWith("--")) {
      const key = token.slice(2);
      result[key] = argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[++index] : true;
    }
  }
  return result;
}

function integerArg(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function quantiles(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
  return { n: sorted.length, min: sorted[0], p50: at(0.5), p95: at(0.95), p99: at(0.99), max: sorted.at(-1), mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length };
}

const sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

async function waitForHealth(url, deadlineMs = 10_000) {
  const started = performance.now();
  const deadline = started + deadlineMs;
  while (performance.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return performance.now() - started;
    } catch {
      // The listener is still starting.
    }
    await sleep(10);
  }
  throw new Error(`server did not become ready at ${url}`);
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([once(child, "exit"), sleep(5_000)]);
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
}

async function runOnce(port, index) {
  const tempRoot = mkdtempSync("/tmp/projectclibox-v2-startup.");
  const home = join(tempRoot, "home");
  const workspace = join(tempRoot, "workspace");
  mkdirSync(home);
  mkdirSync(workspace);
  const child = spawn(binary, ["server"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: home,
      DB_PATH: join(home, "projectclibox.db"),
      PCLX_BIND: "127.0.0.1",
      PCLX_PORT: String(port),
      PCLX_STATIC_DIR: staticDir,
      PCLX_WORKSPACE_ROOT: workspace,
      WORKSPACE_DIR: workspace,
    },
    stdio: "ignore",
  });
  try {
    const readyMs = await waitForHealth(`http://127.0.0.1:${port}/healthz`);
    return { index, port, readyMs };
  } finally {
    await stop(child);
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

const results = [];
for (let index = 0; index < runs; index += 1) results.push(await runOnce(firstPort + index, index + 1));
console.log(JSON.stringify({
  started: new Date().toISOString(),
  host: { node: process.version, platform: process.platform, arch: process.arch, cpus: os.cpus().length },
  config: { binary, staticDir, runs, firstPort },
  runs: results,
  readyLatencyMs: quantiles(results.map((result) => result.readyMs)),
  finished: new Date().toISOString(),
}, null, 2));
