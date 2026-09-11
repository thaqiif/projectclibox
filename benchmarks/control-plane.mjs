#!/usr/bin/env node

import process from "node:process";
import { performance } from "node:perf_hooks";

const args = parseArgs(process.argv.slice(2));
const baseUrl = String(args["base-url"] ?? "http://127.0.0.1:3111").replace(/\/$/, "");
const cwd = String(args.cwd ?? process.cwd());
const counts = listArg(args.counts, [0, 1, 5, 10, 25, 50]);
const concurrency = listArg(args.concurrency, [1, 5, 10, 25, 50]);
const samples = numberArg(args.samples, 10);
const keep = Boolean(args.keep);
const createdNames = [];

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--keep") result.keep = true;
    else if (token.startsWith("--")) {
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
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function listArg(value, fallback) {
  if (value === undefined || value === true) return fallback;
  const values = String(value)
    .split(",")
    .map(Number)
    .filter((item) => Number.isInteger(item) && item >= 0);
  return values.length ? values : fallback;
}

function quantiles(values) {
  if (!values.length) return {};
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
  return {
    n: sorted.length,
    min: sorted[0],
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: sorted.at(-1),
    mean: sorted.reduce((sum, item) => sum + item, 0) / sorted.length,
  };
}

async function request(path, init) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}${path}`, init);
  const elapsed = performance.now() - started;
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`${init?.method ?? "GET"} ${path} returned ${response.status}: ${JSON.stringify(body)}`);
  }
  return { body, elapsed };
}

async function createTerminal() {
  const result = await request("/api/terminals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cwd }),
  });
  const name = result.body?.id;
  if (!name) throw new Error("terminal creation returned no id");
  createdNames.push(name);
  return result.elapsed;
}

async function deleteTerminal(name) {
  await request(`/api/terminals/${encodeURIComponent(name)}`, { method: "DELETE" });
}

const endpoints = {
  projects: () => "/api/projects",
  terminals: () => "/api/terminals",
  files: () => `/api/files?path=${encodeURIComponent(cwd)}`,
};

async function measureEndpoint(path, targetConcurrency) {
  for (let i = 0; i < 2; i += 1) await request(path());
  const timings = [];
  const batches = [];
  for (let sample = 0; sample < samples; sample += 1) {
    const started = performance.now();
    const results = await Promise.all(
      Array.from({ length: targetConcurrency }, () => request(path()))
    );
    batches.push(performance.now() - started);
    timings.push(...results.map((result) => result.elapsed));
  }
  return {
    requestLatencyMs: quantiles(timings),
    batchWallMs: quantiles(batches),
  };
}

async function main() {
  const result = {
    started: new Date().toISOString(),
    host: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    config: { baseUrl, cwd, counts, concurrency, samples },
    targets: {},
  };
  let existing = 0;
  try {
    for (const target of [...new Set(counts)].sort((a, b) => a - b)) {
      const creation = [];
      while (existing < target) {
        creation.push(await createTerminal());
        existing += 1;
      }
      result.targets[target] = {
        terminalCreationMs: quantiles(creation),
        endpoints: {},
      };
      for (const [name, path] of Object.entries(endpoints)) {
        result.targets[target].endpoints[name] = {};
        for (const targetConcurrency of concurrency) {
          result.targets[target].endpoints[name][targetConcurrency] = await measureEndpoint(
            path,
            targetConcurrency
          );
        }
      }
    }
  } finally {
    if (!keep) {
      for (const name of [...createdNames].reverse()) {
        await deleteTerminal(name).catch(() => {});
      }
    }
  }
  result.createdTerminals = createdNames;
  result.finished = new Date().toISOString();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
