#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import os from "node:os";
import process from "node:process";
import { performance } from "node:perf_hooks";
import WebSocket from "../cliweb/node_modules/ws/index.js";

const args = parseArgs(process.argv.slice(2));
const baseUrl = String(args["base-url"] ?? "http://127.0.0.1:3111").replace(
  /\/$/,
  ""
);
const cwd = String(args.cwd ?? process.cwd());
const samples = numberArg(args.samples, 30);
const counts = listArg(args.counts, [0, 1, 5, 10, 25, 50]);
const wsCounts = listArg(args["ws-counts"], [1, 5, 10, 25, 50]);
const outputBytes = numberArg(args["output-bytes"], 1024 * 1024);
const keep = Boolean(args.keep);
const holdMs = numberArg(args["hold-ms"], 0);
const appPid = args["app-pid"] ? Number(args["app-pid"]) : null;
const createdNames = [];

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--keep") {
      result.keep = true;
    } else if (token.startsWith("--")) {
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

async function measureHttp(path, init = {}) {
  const timings = [];
  for (let i = 0; i < samples + 5; i += 1) {
    const result = await request(path, init);
    if (i >= 5) timings.push(result.elapsed);
  }
  return quantiles(timings);
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
  return { name, elapsed: result.elapsed };
}

async function deleteTerminal(name) {
  await request(`/api/terminals/${encodeURIComponent(name)}`, { method: "DELETE" });
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
      for (const row of rows) {
        if (selected.has(row.ppid) && !selected.has(row.pid)) {
          selected.add(row.pid);
          changed = true;
        }
      }
    }
    const tree = rows.filter((row) => selected.has(row.pid));
    return {
      available: true,
      rootPid: pid,
      processCount: tree.length,
      rssMiB: tree.reduce((sum, row) => sum + row.rssKb, 0) / 1024,
      threads: tree.reduce((sum, row) => sum + row.threads, 0),
      processes: tree.map(({ pid: rowPid, ppid, rssKb, threads, args }) => ({
        pid: rowPid,
        ppid,
        rssMiB: rssKb / 1024,
        threads,
        args,
      })),
    };
  } catch (error) {
    return { available: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

function connectTerminal() {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const url = `${baseUrl.replace(/^http/, "ws")}/ws/terminal`;
    const socket = new WebSocket(url);
    let output = "";
    let markerResolve;
    let markerReject;
    const marker = `__PCLX_MARKER_${Math.random().toString(36).slice(2)}__`;
    let openMs;
    let outputStarted = null;
    let outputResolve;
    let outputReject;
    let outputLength = 0;

    const timer = setTimeout(() => {
      markerReject?.(new Error("marker timeout"));
      outputReject?.(new Error("output timeout"));
      socket.terminate();
    }, 15000);

    socket.on("open", () => {
      openMs = performance.now() - started;
      socket.send(JSON.stringify({ type: "command", data: `printf '${marker}\\n'` }));
    });
    socket.on("message", (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        message = { type: "output", data: raw.toString() };
      }
      if (message.type !== "output") return;
      const data = String(message.data ?? "");
      output += data;
      if (markerResolve && output.includes(marker)) {
        const resolveMarker = markerResolve;
        markerResolve = null;
        markerReject = null;
        resolveMarker(performance.now() - started);
        outputStarted = performance.now();
        socket.send(JSON.stringify({
          type: "command",
          data: `head -c ${Math.floor(outputBytes)} /dev/zero | tr '\\0' X`,
        }));
      }
      if (outputStarted !== null) {
          outputLength += Buffer.byteLength(data);
        if (outputLength >= outputBytes && outputResolve) {
          const resolveOutput = outputResolve;
          outputResolve = null;
          outputReject = null;
          resolveOutput({
            bytes: outputLength,
            elapsedMs: performance.now() - outputStarted,
          });
        }
      }
    });
    socket.on("error", (error) => {
      if (openMs === undefined) reject(error);
      markerReject?.(error);
      outputReject?.(error);
    });
    socket.on("close", () => {
      clearTimeout(timer);
    });

    const markerPromise = new Promise((resolveMarker, rejectMarker) => {
      markerResolve = resolveMarker;
      markerReject = rejectMarker;
    });
    const outputPromise = new Promise((resolveOutput, rejectOutput) => {
      outputResolve = resolveOutput;
      outputReject = rejectOutput;
    });

    Promise.all([markerPromise, outputPromise])
      .then(([usableMs, throughput]) => {
        const value = {
          openMs,
          usableMs,
          outputBytes: throughput.bytes,
          outputMs: throughput.elapsedMs,
          outputMiBPerSecond: throughput.bytes / throughput.elapsedMs / 1024,
        };
        const close = () => {
          socket.close();
          resolve(value);
        };
        if (holdMs > 0) setTimeout(close, holdMs);
        else close();
      })
      .catch(reject);
  });
}

async function main() {
  const started = new Date().toISOString();
  const result = {
    started,
    host: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpus: os.cpus().length,
      memoryMiB: os.totalmem() / 1024 / 1024,
    },
    config: { baseUrl, cwd, samples, counts, wsCounts, outputBytes, holdMs },
    http: {},
    terminalCreation: {},
    process: {},
    websocket: {},
  };

  result.http.projects = await measureHttp("/api/projects");
  result.http.terminals = await measureHttp("/api/terminals");
  result.http.files = await measureHttp(`/api/files?path=${encodeURIComponent(cwd)}`);
  result.process.before = processSnapshot(appPid);

  try {
    let existing = 0;
    for (const target of [...new Set(counts)].sort((a, b) => a - b)) {
      while (existing < target) {
        const created = await createTerminal();
        (result.terminalCreation[target] ??= []).push(created.elapsed);
        existing += 1;
      }
      result.terminalCreation[target] = {
        target,
        latencyMs: quantiles(result.terminalCreation[target] ?? []),
        list: await measureHttp("/api/terminals", { headers: { accept: "application/json" } }),
        process: processSnapshot(appPid),
      };
    }

    for (const target of wsCounts) {
      const opened = [];
      const startedAt = performance.now();
      for (let i = 0; i < target; i += 1) {
        opened.push(connectTerminal());
      }
      const sockets = await Promise.all(opened);
      result.websocket[target] = {
        count: target,
        elapsedMs: performance.now() - startedAt,
        latency: quantiles(sockets.map((item) => item.usableMs)),
        openLatency: quantiles(sockets.map((item) => item.openMs)),
        outputLatency: quantiles(sockets.map((item) => item.outputMs)),
        outputMiBPerSecond: quantiles(sockets.map((item) => item.outputMiBPerSecond)),
        process: processSnapshot(appPid),
      };
    }
    result.process.after = processSnapshot(appPid);
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
