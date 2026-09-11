#!/usr/bin/env node

import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import os from "node:os";
import fileModule from "../cliweb/lib/files.ts";
import schema from "../cliweb/lib/db/schema.ts";
import queryModule from "../cliweb/lib/db/queries.ts";

const require = createRequire(import.meta.url);
const Database = require("../cliweb/node_modules/better-sqlite3");
const { createSchema } = schema;
const { queries } = queryModule;
const { listDirectory } = fileModule;
const includeLarge = process.argv.includes("--large");
const root = mkdtempSync(join(tmpdir(), "projectclibox-fixture-"));

function quantiles(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
  return {
    n: sorted.length,
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    min: sorted[0],
    max: sorted.at(-1),
  };
}

function measure(fn, iterations = 12) {
  const timings = [];
  let value;
  for (let i = 0; i < iterations + 2; i += 1) {
    const start = performance.now();
    value = fn();
    if (i >= 2) timings.push(performance.now() - start);
  }
  return { timingsMs: quantiles(timings), value };
}

function makeFixture(name, fileCount) {
  const fixture = join(root, name);
  mkdirSync(fixture, { recursive: true });
  const start = performance.now();
  for (let i = 0; i < fileCount; i += 1) {
    writeFileSync(join(fixture, `file-${String(i).padStart(6, "0")}.txt`), "x\n");
  }
  mkdirSync(join(fixture, "nested", "leaf"), { recursive: true });
  writeFileSync(join(fixture, "nested", "leaf", "deep.txt"), "deep\n");
  return { path: fixture, fileCount, creationMs: performance.now() - start };
}

function benchmarkFixture(fixture) {
  const listed = measure(() => listDirectory(fixture.path));
  const recursive = measure(() => listDirectory(fixture.path, { recursive: true, maxDepth: 2 }));
  const sample = join(fixture.path, "file-000000.txt");
  const read = measure(() => readFileSync(sample, "utf8"));
  const save = measure(() => writeFileSync(sample, "updated\n", "utf8"));
  return {
    files: fixture.fileCount,
    creationMs: fixture.creationMs,
    listDirectory: { ...listed.timingsMs, entries: listed.value.length },
    recursiveListDirectory: { ...recursive.timingsMs, entries: recursive.value.length },
    readFile: read.timingsMs,
    writeFile: save.timingsMs,
  };
}

function benchmarkDb() {
  const dbPath = join(root, "benchmark.db");
  const startupStart = performance.now();
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 10000");
  createSchema(db);
  const startupMs = performance.now() - startupStart;
  const remember = queries.rememberTerminal(db);
  const insertStart = performance.now();
  const insertTransaction = db.transaction((count) => {
    for (let i = 0; i < count; i += 1) remember.run(`term-${i}`, root);
  });
  insertTransaction(1000);
  const insertMs = performance.now() - insertStart;
  const list = measure(() => queries.getAllTerminals(db).all(), 50);
  const projects = measure(() => queries.getAllProjects(db).all(), 50);
  db.close();
  return {
    startupMs,
    insert1000InOneTransactionMs: insertMs,
    list1000: { ...list.timingsMs, rows: list.value.length },
    listProjects: { ...projects.timingsMs, rows: projects.value.length },
  };
}

try {
  const fixtures = [makeFixture("small-100", 100), makeFixture("medium-10000", 10000)];
  if (includeLarge) fixtures.push(makeFixture("large-100000", 100000));
  const result = {
    host: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpus: os.cpus().length,
      memoryMiB: os.totalmem() / 1024 / 1024,
    },
    root,
    filesystem: fixtures.map(benchmarkFixture),
    sqlite: benchmarkDb(),
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
