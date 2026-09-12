#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import process from "node:process";
import WebSocket from "../node_modules/ws/index.js";

const cliArgs = parseArgs(process.argv.slice(2));
const baseUrl = String(cliArgs["base-url"] ?? process.env.BASE_URL ?? "http://127.0.0.1:3211").replace(/\/$/, "");
const created = [];
const socketQueues = new WeakMap();

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

async function json(path, init) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${init?.method ?? "GET"} ${path}: ${response.status} ${JSON.stringify(body)}`);
  return body;
}

function waitFor(socket, predicate, timeoutMs = 5000) {
  let queue = socketQueues.get(socket);
  if (!queue) {
    queue = { messages: [], waiters: [] };
    socket.on("message", (raw) => {
      const value = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      let message;
      if (value.length >= 9 && (value[0] === 1 || value[0] === 2)) {
        message = { type: "binary", kind: value[0] === 2 ? "snapshot" : "delta", sequence: Number(value.readBigUInt64BE(1)), data: value.subarray(9).toString() };
      } else {
        try { message = JSON.parse(value.toString()); } catch { return; }
      }
      const waiterIndex = queue.waiters.findIndex((waiter) => waiter.predicate(message));
      if (waiterIndex >= 0) {
        const waiter = queue.waiters.splice(waiterIndex, 1)[0];
        waiter.resolve(message);
      } else {
        queue.messages.push(message);
      }
    });
    socketQueues.set(socket, queue);
  }
  const queuedIndex = queue.messages.findIndex(predicate);
  if (queuedIndex >= 0) return Promise.resolve(queue.messages.splice(queuedIndex, 1)[0]);
  return new Promise((resolve, reject) => {
    const waiter = { predicate, resolve, reject };
    const timer = setTimeout(() => {
      const waiterIndex = queue.waiters.indexOf(waiter);
      if (waiterIndex >= 0) queue.waiters.splice(waiterIndex, 1);
      reject(new Error("timed out waiting for WebSocket message"));
    }, timeoutMs);
    waiter.resolve = (message) => { clearTimeout(timer); resolve(message); };
    waiter.reject = reject;
    queue.waiters.push(waiter);
  });
}

async function attach(id, { mode = "snapshot", fromSequence, cols = 80, rows = 24 } = {}) {
  const socket = new WebSocket(`${baseUrl.replace(/^http/, "ws")}/ws/terminal`);
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  socket.send(JSON.stringify({ type: "terminal.attach", sessionId: id, mode, ...(fromSequence === undefined ? {} : { fromSequence }), cols, rows }));
  const ready = await waitFor(socket, (message) => message.type === "terminal.ready");
  return { socket, ready };
}

async function waitForSnapshot(socket) {
  await waitFor(socket, (message) => message.type === "terminal.snapshot");
  return waitFor(
    socket,
    (message) => message.type === "binary" && message.kind === "snapshot"
  );
}

async function waitForOutputContaining(socket, needle, kind = "delta") {
  let data = "";
  for (;;) {
    const message = await waitFor(
      socket,
      (candidate) => candidate.type === "binary" && candidate.kind === kind
    );
    data += message.data;
    if (data.includes(needle)) return { ...message, data };
  }
}

async function close(socket) {
  if (socket.readyState === WebSocket.CLOSED) return;
  await new Promise((resolve) => { socket.once("close", resolve); socket.close(); });
}

async function waitForStopped(id) {
  for (let i = 0; i < 50; i += 1) {
    const sessions = await json("/api/terminals");
    const session = sessions.find((item) => item.id === id);
    if (session && ["exited", "failed"].includes(session.status)) return session;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`session ${id} did not stop`);
}

async function terminateAndForget(id) {
  await json(`/api/terminals/${id}/terminate`, { method: "POST" }).catch(() => {});
  await waitForStopped(id).catch(() => {});
  await json(`/api/terminals/${id}`, { method: "DELETE" }).catch(() => {});
}

async function main() {
  const projects = await json("/api/projects");
  const projectId = projects.projects.find((project) => project.id === "uncategorized")?.id ?? projects.projects[0]?.id;
  if (!projectId) throw new Error("no project available");
  const marker = `PCLX_V2_${Date.now()}`;
  const markerBytes = Buffer.from(marker).toString("hex").replace(/../g, "\\x$&");
  const session = await json("/api/terminals", {
    method: "POST",
    body: JSON.stringify({ project_id: projectId, name: "Acceptance shell", command: ["/bin/bash", "-i"] }),
  });
  created.push(session.id);

  const first = await attach(session.id);
  const firstSnapshot = await waitForSnapshot(first.socket);
  if (firstSnapshot.data.length === 0) {
    throw new Error("fresh attach did not deliver a snapshot payload");
  }
  const progress =
    Array.from({ length: 101 }, (_, percent) =>
      `\\rprogress ${String(percent).padStart(3, "0")}%`
    ).join("") + "\\r\\nComplete\\n";
  const progressBytes = Buffer.from(progress)
    .toString("hex")
    .replace(/../g, "\\x$&");
  first.socket.send(
    JSON.stringify({
      type: "terminal.input",
      data: `printf '%b' '${progressBytes}'\r`,
    })
  );
  await waitForOutputContaining(first.socket, "progress 100%");
  first.socket.send(JSON.stringify({ type: "terminal.input", data: `printf '${markerBytes}\\n'\r` }));
  const firstOutput = await waitFor(first.socket, (message) => message.type === "binary" && message.data.includes(marker));
  await close(first.socket);
  await new Promise((resolve) => setTimeout(resolve, 100));
  let current = (await json("/api/terminals")).find((item) => item.id === session.id);
  if (!['running', 'disconnected'].includes(current.status) || current.attached_viewers !== 0) throw new Error(`detach killed or retained viewer: ${JSON.stringify(current)}`);

  const second = await attach(session.id, { mode: "resume", fromSequence: 0 });
  const replay = await waitFor(second.socket, (message) => message.type === "binary" && message.data.includes(marker));
  const third = await attach(session.id, { mode: "snapshot" });
  const thirdSnapshot = await waitForSnapshot(third.socket);
  if (!thirdSnapshot.data.includes("progress 100%") || thirdSnapshot.data.includes("progress 005%")) {
    throw new Error("fresh snapshot contained dynamic redraw history");
  }
  second.socket.send(
    JSON.stringify({ type: "terminal.resize", cols: 100, rows: 30 })
  );
  for (let attempt = 0; attempt < 20; attempt += 1) {
    current = (await json("/api/terminals")).find((item) => item.id === session.id);
    if (current?.cols === 100 && current?.rows === 30) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  current = (await json("/api/terminals")).find((item) => item.id === session.id);
  if (current?.cols !== 100 || current?.rows !== 30) {
    throw new Error(`owner resize was not applied: ${JSON.stringify(current)}`);
  }
  third.socket.send(
    JSON.stringify({ type: "terminal.resize", cols: 120, rows: 40 })
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  current = (await json("/api/terminals")).find((item) => item.id === session.id);
  if (current?.cols !== 100 || current?.rows !== 30) {
    throw new Error(`non-owner resize changed canonical geometry: ${JSON.stringify(current)}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
  if (current.attached_viewers !== 2) throw new Error(`multiple viewers not counted: ${JSON.stringify(current)}`);
  await close(second.socket);
  await close(third.socket);

  const traversal = await fetch(`${baseUrl}/api/files?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent("../")}`);
  if (traversal.status !== 403) throw new Error(`path traversal returned ${traversal.status}`);

  const tuiSession = await json("/api/terminals", {
    method: "POST",
    body: JSON.stringify({
      project_id: projectId,
      name: "Acceptance alternate screen",
      command: [
        "/bin/bash",
        "-lc",
        "printf '\\033[?1049h\\033[2J\\033[Hscreen-initial'; printf '\\033[2J\\033[Hscreen-current'; while :; do sleep 60; done",
      ],
    }),
  });
  created.push(tuiSession.id);
  const tuiOutputBytes =
    "\x1b[?1049h\x1b[2J\x1b[Hscreen-initial".length +
    "\x1b[2J\x1b[Hscreen-current".length;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const current = (await json("/api/terminals")).find(
      (item) => item.id === tuiSession.id
    );
    if (current?.output_bytes >= tuiOutputBytes) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const tuiCurrent = (await json("/api/terminals")).find(
    (item) => item.id === tuiSession.id
  );
  if (tuiCurrent?.output_bytes < tuiOutputBytes) {
    throw new Error("alternate-screen session did not finish drawing");
  }
  const tui = await attach(tuiSession.id);
  const tuiSnapshot = await waitForSnapshot(tui.socket);
  if (
    !tuiSnapshot.data.includes("screen-current") ||
    tuiSnapshot.data.includes("screen-initial")
  ) {
    throw new Error("alternate-screen snapshot was not current");
  }
  await close(tui.socket);
  await json(`/api/terminals/${tuiSession.id}`, { method: "DELETE" });
  created.pop();

  const dynamicSession = await json("/api/terminals", {
    method: "POST",
    body: JSON.stringify({
      project_id: projectId,
      name: "Acceptance dynamic output",
      command: [
        "/bin/bash",
        "-lc",
        "for i in $(seq 0 20000); do printf '\\rprogress %05d%%' \"$((i % 101))\"; done; printf '\\rprogress 100%%\\nComplete\\n'; while :; do sleep 60; done",
      ],
    }),
  });
  created.push(dynamicSession.id);
  const dynamicOutputBytes =
    20_001 * "\rprogress 00000%".length + "\rprogress 100%\nComplete\n".length;
  let dynamicReady = false;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const current = (await json("/api/terminals")).find(
      (item) => item.id === dynamicSession.id
    );
    if (current?.output_bytes >= dynamicOutputBytes) {
      dynamicReady = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!dynamicReady) {
    throw new Error("dynamic-output session did not finish generating output");
  }
  const dynamic = await attach(dynamicSession.id);
  const dynamicSnapshot = await waitForSnapshot(dynamic.socket);
  if (
    !dynamicSnapshot.data.includes("progress 100%") ||
    dynamicSnapshot.data.includes("progress 00000%")
  ) {
    throw new Error("large dynamic output was not resolved before snapshot attach");
  }
  if (dynamicSnapshot.data.length > 64 * 1024) {
    throw new Error(
      `dynamic snapshot unexpectedly large: ${dynamicSnapshot.data.length} bytes`
    );
  }
  await close(dynamic.socket);
  const fallback = await attach(dynamicSession.id, {
    mode: "resume",
    fromSequence: 0,
  });
  if (fallback.ready.mode !== "snapshot" || !fallback.ready.truncated) {
    throw new Error("truncated delta resume did not fall back to a snapshot");
  }
  const fallbackSnapshot = await waitForSnapshot(fallback.socket);
  if (
    !fallbackSnapshot.data.includes("progress 100%") ||
    fallbackSnapshot.data.includes("progress 00000%")
  ) {
    throw new Error("delta fallback snapshot was not resolved current state");
  }
  await close(fallback.socket);
  await json(`/api/terminals/${dynamicSession.id}`, { method: "DELETE" });
  created.pop();

  const processSession = await json("/api/terminals", {
    method: "POST",
    body: JSON.stringify({ project_id: projectId, name: "Acceptance process group", command: ["/bin/bash", "-lc", "sleep 60 & wait"] }),
  });
  created.push(processSession.id);
  const childPid = processSession.child_pid;
  await json(`/api/terminals/${processSession.id}/terminate`, { method: "POST" });
  const stopped = await waitForStopped(processSession.id);
  if (stopped.status !== "exited") throw new Error(`terminated group was marked ${stopped.status}`);
  if (childPid) {
    try { process.kill(childPid, 0); throw new Error(`child pid ${childPid} is still alive`); } catch (error) {
      if (error instanceof Error && error.message.includes("still alive")) throw error;
    }
  }
  await json(`/api/terminals/${processSession.id}`, { method: "DELETE" });
  created.pop();

  const batchSessions = await Promise.all(
    [0, 1, 2].map((index) =>
      json("/api/terminals", {
        method: "POST",
        body: JSON.stringify({
          project_id: projectId,
          name: `Acceptance close-all-${index}`,
          command: ["/bin/bash", "-lc", "trap '' TERM; while :; do sleep 1; done"],
        }),
      })
    )
  );
  created.push(...batchSessions.map((item) => item.id));
  await Promise.all(
    batchSessions.map((item) =>
      json(`/api/terminals/${item.id}`, { method: "DELETE" })
    )
  );
  const afterBatchDelete = await json("/api/terminals");
  if (batchSessions.some((item) => afterBatchDelete.some((current) => current.id === item.id))) {
    throw new Error("close-all left a deleted session visible");
  }
  // DELETE is idempotent so a stale list or a double click cannot surface a
  // false failure after the requested state has already been reached.
  await Promise.all(
    batchSessions.map((item) =>
      json(`/api/terminals/${item.id}`, { method: "DELETE" })
    )
  );
  created.splice(-batchSessions.length);

  await json(`/api/terminals/${session.id}/terminate`, { method: "POST" }).catch(() => {});
  await waitForStopped(session.id);
  await json(`/api/terminals/${session.id}`, { method: "DELETE" });
  created.pop();
  console.log(JSON.stringify({ sessionId: session.id, firstSequence: firstOutput.sequence, replaySequence: replay.sequence, detached: true, multipleViewers: 2, snapshotResolved: true, alternateScreen: true, largeDynamicOutput: true, resizeOwner: true, traversalRejected: true, processGroupStopped: true, batchDeleted: batchSessions.length }));
}

try {
  await main();
} finally {
  for (const id of created.splice(0)) await terminateAndForget(id);
}
