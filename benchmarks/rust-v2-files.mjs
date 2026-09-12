#!/usr/bin/env node

import { mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";

const args = parseArgs(process.argv.slice(2));
const baseUrl = String(args["base-url"] ?? "http://127.0.0.1:3111").replace(/\/$/, "");
const root = path.resolve(String(args.root ?? process.env.PCLX_WORKSPACE_ROOT ?? process.cwd()));
const projectId = String(args["project-id"] ?? "uncategorized");
const sizes = listArg(args.sizes, [100, 10_000, 100_000]);
const samples = numberArg(args.samples, 5);
const pageLimit = numberArg(args.limit, 200);
const prefix = `.projectclibox-v2-files-${process.pid}`;
const fixtureRoots = [];

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

function numberArg(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function listArg(value, fallback) {
  if (value === undefined || value === true) return fallback;
  const result = String(value).split(",").map(Number).filter((item) => Number.isInteger(item) && item >= 0);
  return result.length ? result : fallback;
}

function quantiles(values) {
  if (!values.length) return {};
  const sorted = [...values].sort((left, right) => left - right);
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

async function request(pathname) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}${pathname}`);
  const elapsed = performance.now() - started;
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`GET ${pathname}: ${response.status} ${JSON.stringify(body)}`);
  return { body, elapsed };
}

async function createFixture(size) {
  const directory = path.join(root, `${prefix}-${size}`);
  fixtureRoots.push(directory);
  await mkdir(directory, { recursive: false });
  const content = "projectclibox\n";
  const batchSize = 512;
  for (let start = 0; start < size; start += batchSize) {
    const end = Math.min(size, start + batchSize);
    await Promise.all(Array.from({ length: end - start }, (_, offset) => {
      const index = start + offset;
      return writeFile(path.join(directory, `file-${String(index).padStart(7, "0")}.txt`), content);
    }));
  }
  return directory;
}

async function measure(size) {
  const relative = `${prefix}-${size}`;
  const pathname = `/api/files?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent(relative)}&limit=${pageLimit}`;
  const timings = [];
  let page;
  for (let index = 0; index < samples + 2; index += 1) {
    const result = await request(pathname);
    if (index >= 2) timings.push(result.elapsed);
    page = result.body;
  }
  return {
    size,
    directory: relative,
    listMs: quantiles(timings),
    page: {
      returned: page.files.length,
      scanned: page.scanned,
      truncated: page.truncated,
      nextCursor: page.next_cursor,
    },
  };
}

try {
  const measurements = [];
  for (const size of sizes) {
    await createFixture(size);
    measurements.push(await measure(size));
  }
  console.log(JSON.stringify({
    started: new Date().toISOString(),
    host: { node: process.version, platform: process.platform, arch: process.arch, cpus: os.cpus().length },
    config: { baseUrl, root, projectId, sizes, samples, pageLimit },
    measurements,
    finished: new Date().toISOString(),
  }, null, 2));
} finally {
  await Promise.all(fixtureRoots.map((directory) => rm(directory, { recursive: true, force: true })));
}
