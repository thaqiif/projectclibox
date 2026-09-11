#!/usr/bin/env node

import process from "node:process";
import { performance } from "node:perf_hooks";
import WebSocket from "../cliweb/node_modules/ws/index.js";

const args = parseArgs(process.argv.slice(2));
const baseUrl = String(args["base-url"] ?? "http://127.0.0.1:3111").replace(
  /\/$/,
  ""
);
const cwd = String(args.cwd ?? process.cwd());
const counts = listArg(args.counts, [1, 5, 10, 25, 50]);
const outputBytes = numberArg(args["output-bytes"], 256 * 1024);
const keep = Boolean(args.keep);
const debug = Boolean(args.debug);
const holdMs = numberArg(args["hold-ms"], 0);
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

function quote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function connectThroughTmux(name) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const socket = new WebSocket(`${baseUrl.replace(/^http/, "ws")}/ws/terminal`);
    const marker = `__PCLX_TMUX_MARKER_${Math.random().toString(36).slice(2)}__`;
    const completionMarker = `__PCLX_TMUX_DONE_${Math.random().toString(36).slice(2)}__`;
    let markerResolve;
    let markerReject;
    let outputResolve;
    let outputReject;
    let outputStarted = null;
    let openMs;
    let settled = false;
    const previews = [];

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

    const timer = setTimeout(() => {
      markerReject?.(new Error(`tmux marker timeout for ${name}`));
      outputReject?.(new Error(`tmux output timeout for ${name}`));
      finish(new Error(`tmux attach timeout for ${name}; output=${JSON.stringify(previews)}`));
    }, 20000);

    socket.on("open", () => {
      openMs = performance.now() - started;
      const options =
        "tmux set -g mouse on 2>/dev/null; " +
        "tmux set -g status off 2>/dev/null; " +
        "tmux set -g default-command 'exec \"${SHELL:-/bin/bash}\"' 2>/dev/null; ";
      socket.send(JSON.stringify({
        type: "command",
        data: `${options}tmux attach -t ${quote(name)}`,
      }));
      // The attach command replaces the intermediary shell.  Send the probe
      // after a short settling interval so the bytes are consumed by tmux,
      // not left on the shell's pre-attach command line.
      setTimeout(() => {
        if (!settled && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "command", data: `printf '${marker}\\n'` }));
        }
      }, 250);
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
      if (debug && previews.length < 8) previews.push(data.slice(0, 200));
      if (debug && outputStarted !== null && data.includes(completionMarker)) {
        process.stderr.write(`tmux-command-complete name=${name}\\n`);
      }
      if (markerResolve && data.includes(marker)) {
        const resolveMarker = markerResolve;
        markerResolve = null;
        markerReject = null;
        resolveMarker(performance.now() - started);
        outputStarted = performance.now();
        setTimeout(() => {
          if (!settled && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
              type: "command",
              data: `head -c ${Math.floor(outputBytes)} /dev/zero | tr '\\0' X >/dev/null; printf '${completionMarker}\\n'`,
            }));
          }
        }, 100);
      }
      if (outputStarted !== null && data.includes(completionMarker) && outputResolve) {
        const resolveOutput = outputResolve;
        outputResolve = null;
        outputReject = null;
        resolveOutput({ elapsedMs: performance.now() - outputStarted });
      }
    });

    socket.on("error", (error) => {
      markerReject?.(error);
      outputReject?.(error);
      finish(error);
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
          outputMs: throughput.elapsedMs,
          commandBytes: outputBytes,
        };
        if (holdMs > 0) {
          setTimeout(() => finish(null, value), holdMs);
        } else {
          finish(null, value);
        }
      })
      .catch((error) => finish(error));
  });
}

async function main() {
  const result = {
    started: new Date().toISOString(),
    host: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    config: { baseUrl, cwd, counts, outputBytes, holdMs },
    terminalCreation: {},
    websocket: {},
  };

  const activeNames = [];
  try {
    let existing = 0;
    for (const target of [...new Set(counts)].sort((a, b) => a - b)) {
      const created = [];
      while (existing < target) {
        const terminal = await createTerminal();
        created.push(terminal);
        activeNames.push(terminal.name);
        existing += 1;
      }
      result.terminalCreation[target] = {
        target,
        latencyMs: quantiles(created.map((item) => item.elapsed)),
        sessions: created.map((item) => item.name),
      };

      const started = performance.now();
      const attached = await Promise.all(activeNames.map((name) => connectThroughTmux(name)));
      result.websocket[target] = {
        count: target,
        batchElapsedMs: performance.now() - started,
        attachLatency: quantiles(attached.map((item) => item.usableMs)),
        openLatency: quantiles(attached.map((item) => item.openMs)),
        commandLatency: quantiles(attached.map((item) => item.outputMs)),
      };
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
