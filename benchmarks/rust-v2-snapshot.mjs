#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import os from "node:os";
import process from "node:process";
import { performance } from "node:perf_hooks";
import WebSocket from "../node_modules/ws/index.js";

const args = parseArgs(process.argv.slice(2));
const baseUrl = String(args["base-url"] ?? "http://127.0.0.1:3111").replace(/\/$/, "");
const projectId = String(args["project-id"] ?? "uncategorized");
const counts = listArg(args.counts, [1, 10, 25, 50]);
const samples = numberArg(args.samples, 5);
const appPid = args["app-pid"] ? Number(args["app-pid"]) : null;
const keep = Boolean(args.keep);
const created = [];

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--keep") result.keep = true;
    else if (token.startsWith("--")) result[token.slice(2)] = argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[++index] : true;
  }
  return result;
}

function numberArg(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function listArg(value, fallback) {
  if (value === undefined || value === true) return fallback;
  const values = String(value).split(",").map(Number).filter((item) => Number.isInteger(item) && item > 0);
  return values.length ? values : fallback;
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
    max: sorted.at(-1),
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
  };
}

async function request(path, init) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${init?.method ?? "GET"} ${path}: ${response.status} ${JSON.stringify(body)}`);
  return body;
}

function processSnapshot(pid) {
  if (!pid || !Number.isInteger(pid)) return { available: false, reason: "--app-pid not supplied" };
  try {
    const rows = execFileSync("ps", ["-eo", "pid=,ppid=,rss=,nlwp=,args="], { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
        return match && { pid: Number(match[1]), ppid: Number(match[2]), rssKb: Number(match[3]), threads: Number(match[4]), args: match[5] };
      })
      .filter(Boolean);
    const selected = new Set([pid]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const row of rows) if (selected.has(row.ppid) && !selected.has(row.pid)) { selected.add(row.pid); changed = true; }
    }
    const tree = rows.filter((row) => selected.has(row.pid));
    return {
      available: true,
      rootPid: pid,
      processCount: tree.length,
      rssMiB: tree.reduce((sum, row) => sum + row.rssKb, 0) / 1024,
      threads: tree.reduce((sum, row) => sum + row.threads, 0),
    };
  } catch (error) {
    return { available: false, reason: String(error) };
  }
}

async function createSession() {
  const session = await request("/api/terminals", {
    method: "POST",
    body: JSON.stringify({ project_id: projectId, name: `snapshot-bench-${Math.random().toString(36).slice(2, 9)}`, command: ["/bin/bash", "-i"] }),
  });
  created.push(session.id);
  return session;
}

function snapshotAttach(id) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const socket = new WebSocket(`${baseUrl.replace(/^http/, "ws")}/ws/terminal`);
    let controlSeen = false;
    let settled = false;
    const timer = setTimeout(() => finish(new Error("snapshot WebSocket timeout")), 15000);
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        socket.terminate();
        reject(error);
      } else {
        socket.close();
        resolve(value);
      }
    };
    socket.on("open", () => {
      socket.send(JSON.stringify({ type: "terminal.attach", sessionId: id, mode: "snapshot", cols: 80, rows: 24 }));
    });
    socket.on("message", (raw) => {
      const value = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      if (value.length >= 9 && value[0] === 2) {
        if (!controlSeen) return;
        finish(null, {
          snapshotMs: performance.now() - started,
          snapshotBytes: value.length - 9,
          sequence: Number(value.readBigUInt64BE(1)),
        });
        return;
      }
      if (value[0] !== 123) return;
      let message;
      try { message = JSON.parse(value.toString()); } catch { return; }
      if (message.type === "terminal.snapshot") controlSeen = true;
    });
    socket.on("error", (error) => finish(error));
  });
}

async function deleteSession(id) {
  await fetch(`${baseUrl}/api/terminals/${id}`, { method: "DELETE" }).catch(() => {});
}

async function main() {
  const orderedCounts = [...new Set(counts)].sort((left, right) => left - right);
  const result = {
    started: new Date().toISOString(),
    host: { node: process.version, platform: process.platform, arch: process.arch, cpus: os.cpus().length, memoryMiB: os.totalmem() / 1024 / 1024 },
    config: { baseUrl, projectId, counts: orderedCounts, samples },
    targets: {},
  };
  let existing = 0;
  try {
    for (const target of orderedCounts) {
      while (existing < target) { await createSession(); existing += 1; }
      const measurements = [];
      for (let sample = 0; sample < samples; sample += 1) {
        const batchStarted = performance.now();
        const attached = await Promise.all(created.slice(0, target).map((id) => snapshotAttach(id)));
        measurements.push({ attached, batchMs: performance.now() - batchStarted });
      }
      const individual = measurements.flatMap((item) => item.attached.map((value) => value.snapshotMs));
      result.targets[target] = {
        snapshot: quantiles(individual),
        batch: quantiles(measurements.map((item) => item.batchMs)),
        payloadBytes: quantiles(measurements.flatMap((item) => item.attached.map((value) => value.snapshotBytes))),
        process: processSnapshot(appPid),
      };
    }
  } finally {
    if (!keep) for (const id of [...created].reverse()) await deleteSession(id);
  }
  result.createdSessions = created;
  result.finished = new Date().toISOString();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => { console.error(error?.stack || error); process.exitCode = 1; });
