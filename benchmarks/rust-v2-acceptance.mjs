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
  first.socket.send(JSON.stringify({ type: "terminal.input", data: `printf '${markerBytes}\\n'\r` }));
  const firstOutput = await waitFor(first.socket, (message) => message.type === "binary" && message.data.includes(marker));
  await close(first.socket);
  await new Promise((resolve) => setTimeout(resolve, 100));
  let current = (await json("/api/terminals")).find((item) => item.id === session.id);
  if (!['running', 'disconnected'].includes(current.status) || current.attached_viewers !== 0) throw new Error(`detach killed or retained viewer: ${JSON.stringify(current)}`);

  const second = await attach(session.id, { mode: "resume", fromSequence: 0 });
  const replay = await waitFor(second.socket, (message) => message.type === "binary" && message.data.includes(marker));
  const third = await attach(session.id, { mode: "snapshot" });
  await new Promise((resolve) => setTimeout(resolve, 100));
  current = (await json("/api/terminals")).find((item) => item.id === session.id);
  if (current.attached_viewers !== 2) throw new Error(`multiple viewers not counted: ${JSON.stringify(current)}`);
  await close(second.socket);
  await close(third.socket);

  const traversal = await fetch(`${baseUrl}/api/files?projectId=${encodeURIComponent(projectId)}&path=${encodeURIComponent("../")}`);
  if (traversal.status !== 403) throw new Error(`path traversal returned ${traversal.status}`);

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
  console.log(JSON.stringify({ sessionId: session.id, firstSequence: firstOutput.sequence, replaySequence: replay.sequence, detached: true, multipleViewers: 2, traversalRejected: true, processGroupStopped: true, batchDeleted: batchSessions.length }));
}

try {
  await main();
} finally {
  for (const id of created.splice(0)) await terminateAndForget(id);
}
