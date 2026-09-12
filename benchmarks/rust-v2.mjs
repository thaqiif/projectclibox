#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import os from "node:os";
import process from "node:process";
import { performance } from "node:perf_hooks";
import WebSocket from "../node_modules/ws/index.js";

const args = parseArgs(process.argv.slice(2));
const baseUrl = String(args["base-url"] ?? "http://127.0.0.1:3111").replace(/\/$/, "");
const projectId = String(args["project-id"] ?? "uncategorized");
const counts = listArg(args.counts, [0, 1, 5, 10, 25, 50]);
const concurrency = listArg(args.concurrency, [1, 10, 50]);
const wsCounts = listArg(args["ws-counts"], [1, 5, 10, 25, 50]);
const samples = numberArg(args.samples, 10);
const outputBytes = numberArg(args["output-bytes"], 256 * 1024);
const keep = Boolean(args.keep);
const appPid = args["app-pid"] ? Number(args["app-pid"]) : null;
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
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function listArg(value, fallback) {
  if (value === undefined || value === true) return fallback;
  const values = String(value).split(",").map(Number).filter((value) => Number.isInteger(value) && value >= 0);
  return values.length ? values : fallback;
}

function quantiles(values) {
  if (!values.length) return {};
  const sorted = [...values].sort((left, right) => left - right);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
  return { n: sorted.length, min: sorted[0], p50: at(.5), p95: at(.95), p99: at(.99), max: sorted.at(-1), mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length };
}

async function request(path, init) {
  const start = performance.now();
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  const elapsed = performance.now() - start;
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${init?.method ?? "GET"} ${path}: ${response.status} ${JSON.stringify(body)}`);
  return { body, elapsed };
}

async function createSession() {
  const result = await request("/api/terminals", { method: "POST", body: JSON.stringify({ project_id: projectId, name: `bench-${Math.random().toString(36).slice(2, 9)}`, command: ["/bin/bash", "-i"] }) });
  created.push(result.body.id);
  return result;
}

function processSnapshot(pid) {
  if (!pid || !Number.isInteger(pid)) return { available: false, reason: "--app-pid not supplied" };
  try {
    const rows = execFileSync("ps", ["-eo", "pid=,ppid=,rss=,nlwp=,args="], { encoding: "utf8" }).trim().split("\n").filter(Boolean).map((line) => {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
      return match && { pid: Number(match[1]), ppid: Number(match[2]), rssKb: Number(match[3]), threads: Number(match[4]), args: match[5] };
    }).filter(Boolean);
    const selected = new Set([pid]);
    let changed = true;
    while (changed) { changed = false; for (const row of rows) if (selected.has(row.ppid) && !selected.has(row.pid)) { selected.add(row.pid); changed = true; } }
    const tree = rows.filter((row) => selected.has(row.pid));
    return { available: true, rootPid: pid, processCount: tree.length, rssMiB: tree.reduce((sum, row) => sum + row.rssKb, 0) / 1024, threads: tree.reduce((sum, row) => sum + row.threads, 0) };
  } catch (error) { return { available: false, reason: String(error) }; }
}

function attach(id, bytes) {
  return new Promise((resolve, reject) => {
    const start = performance.now();
    const marker = `PCLX_BENCH_${Math.random().toString(36).slice(2)}__`;
    const markerBytes = Buffer.from(marker).toString("hex").replace(/../g, "\\x$&");
    const markerCommand = `printf '${markerBytes}\\n'\r`;
    const socket = new WebSocket(`${baseUrl.replace(/^http/, "ws")}/ws/terminal`);
    let openMs;
    let readyMs;
    let outputStart;
    let outputLength = 0;
    let markerSeen = false;
    let outputCommandSent = false;
    let settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); if (error) { socket.terminate(); reject(error); } else { socket.close(); resolve(value); } };
    const timer = setTimeout(() => finish(new Error("benchmark WebSocket timeout")), 15000);
    socket.on("open", () => { openMs = performance.now() - start; socket.send(JSON.stringify({ type: "terminal.attach", sessionId: id, fromSequence: 0 })); });
    socket.on("message", (raw) => {
      const value = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      if (value.length >= 9 && value[0] === 1) {
        const data = value.subarray(9).toString();
        if (readyMs !== undefined) {
          markerSeen ||= data.includes(marker);
          if (markerSeen && outputStart === undefined) {
            outputStart = performance.now();
            outputLength = 0;
            if (!outputCommandSent) {
              outputCommandSent = true;
              socket.send(JSON.stringify({ type: "terminal.input", data: `head -c ${Math.floor(bytes)} /dev/zero | tr '\\0' X\r` }));
            }
          } else if (outputStart !== undefined) {
            outputLength += value.length - 9;
          }
          if (outputLength >= bytes && markerSeen) finish(null, { openMs, usableMs: readyMs, outputMs: performance.now() - outputStart, outputBytes: outputLength });
        }
        return;
      }
      let message; try { message = JSON.parse(value.toString()); } catch { return; }
      if (message.type === "terminal.ready" && readyMs === undefined) {
        readyMs = performance.now() - start;
        socket.send(JSON.stringify({ type: "terminal.input", data: markerCommand }));
      }
    });
    socket.on("error", (error) => finish(error));
  });
}

async function terminate(id) {
  await request(`/api/terminals/${id}/terminate`, { method: "POST" }).catch(() => {});
  for (let index = 0; index < 40; index += 1) {
    const sessions = (await request("/api/terminals")).body;
    const session = sessions.find((item) => item.id === id);
    if (session && ["exited", "failed"].includes(session.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await request(`/api/terminals/${id}`, { method: "DELETE" }).catch(() => {});
}

async function measureList(concurrencyValue) {
  const values = [];
  const batches = [];
  for (let sample = 0; sample < samples; sample += 1) {
    const start = performance.now();
    const results = await Promise.all(Array.from({ length: concurrencyValue }, () => request("/api/terminals")));
    batches.push(performance.now() - start);
    values.push(...results.map((result) => result.elapsed));
  }
  return { requestLatencyMs: quantiles(values), batchWallMs: quantiles(batches) };
}

async function main() {
  const result = { started: new Date().toISOString(), host: { node: process.version, platform: process.platform, arch: process.arch, cpus: os.cpus().length, memoryMiB: os.totalmem() / 1024 / 1024 }, config: { baseUrl, projectId, counts, concurrency, wsCounts, samples, outputBytes }, targets: {}, process: {} };
  let existing = 0;
  try {
    for (const target of [...new Set(counts)].sort((left, right) => left - right)) {
      const creation = [];
      while (existing < target) { creation.push((await createSession()).elapsed); existing += 1; }
      result.targets[target] = { terminalCreationMs: quantiles(creation), list: {}, process: processSnapshot(appPid) };
      for (const value of concurrency) result.targets[target].list[value] = await measureList(value);
    }
    for (const target of wsCounts) {
      const names = created.slice(0, target);
      const start = performance.now();
      const attached = await Promise.all(names.map((id) => attach(id, outputBytes)));
      result.targets[target] ??= {};
      result.targets[target].websocket = { count: target, batchElapsedMs: performance.now() - start, usable: quantiles(attached.map((item) => item.usableMs)), open: quantiles(attached.map((item) => item.openMs)), output: quantiles(attached.map((item) => item.outputMs)), process: processSnapshot(appPid) };
    }
    result.process.after = processSnapshot(appPid);
  } finally {
    if (!keep) for (const id of [...created].reverse()) await terminate(id);
  }
  result.createdSessions = created;
  result.finished = new Date().toISOString();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => { console.error(error?.stack || error); process.exitCode = 1; });
