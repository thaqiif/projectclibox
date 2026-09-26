/**
 * Native scroll bridge for TUIs that speak the Handterm protocol (jcode).
 *
 * A TUI finds the host through HANDTERM_NATIVE_SCROLL_SOCKET, connects to
 * that Unix socket and exchanges newline-delimited JSON:
 *
 *   app → host  {"type":"pane_snapshot","panes":[{kind,x,y,width,height,
 *                position,content_length,viewport_length}]}
 *   host → app  {"type":"scroll","pane":"chat","delta":-3}
 *
 * Each pane says exactly which rows scroll and how far they can go, and a
 * scroll request moves exactly `delta` rows (negative = towards older
 * output). That is everything touch scrolling otherwise has to infer from
 * redraws, so the browser pans those panes precisely.
 *
 * The socket lives while a browser is attached to the terminal; the app
 * reconnects on its own whenever it appears.
 */

import { execFile } from "child_process";
import crypto from "crypto";
import fs from "fs";
import net from "net";
import os from "os";
import path from "path";
import { promisify } from "util";
import { buildCliboxEnvironment } from "./runtime-environment";

const execFileAsync = promisify(execFile);

export const NATIVE_SCROLL_SOCKET_ENV = "HANDTERM_NATIVE_SCROLL_SOCKET";

export type NativeScrollPaneKind = "chat" | "side_panel";

export interface NativeScrollPane {
  kind: NativeScrollPaneKind;
  x: number;
  y: number;
  width: number;
  height: number;
  position: number;
  content_length: number;
  viewport_length: number;
}

const MAX_LINE_BYTES = 64 * 1024;
const MAX_PANES = 8;
const MAX_COORDINATE = 10_000;
const MAX_LENGTH = 100_000_000;
const MAX_DELTA = 10_000;
const VISIBILITY_POLL_MS = 1000;

function nativeScrollSocketDir(): string {
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  return path.join(os.tmpdir(), `clibox-native-scroll-${uid}`);
}

/** A fresh socket path. Random, so renaming a terminal cannot orphan it. */
export function newNativeScrollSocketPath(): string {
  return path.join(
    nativeScrollSocketDir(),
    `${crypto.randomBytes(8).toString("hex")}.sock`
  );
}

function isCount(value: unknown, max: number): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= max
  );
}

/** Validates one app → host line; anything unexpected is dropped. */
export function parsePaneSnapshot(line: string): NativeScrollPane[] | null {
  let message: unknown;
  try {
    message = JSON.parse(line);
  } catch {
    return null;
  }
  if (
    !message ||
    typeof message !== "object" ||
    (message as { type?: unknown }).type !== "pane_snapshot"
  ) {
    return null;
  }
  const panes = (message as { panes?: unknown }).panes;
  if (!Array.isArray(panes) || panes.length > MAX_PANES) return null;
  const result: NativeScrollPane[] = [];
  for (const pane of panes) {
    if (!pane || typeof pane !== "object") return null;
    const p = pane as Record<string, unknown>;
    if (p.kind !== "chat" && p.kind !== "side_panel") return null;
    if (
      !isCount(p.x, MAX_COORDINATE) ||
      !isCount(p.y, MAX_COORDINATE) ||
      !isCount(p.width, MAX_COORDINATE) ||
      !isCount(p.height, MAX_COORDINATE) ||
      !isCount(p.position, MAX_LENGTH) ||
      !isCount(p.content_length, MAX_LENGTH) ||
      !isCount(p.viewport_length, MAX_LENGTH)
    ) {
      return null;
    }
    result.push({
      kind: p.kind,
      x: p.x,
      y: p.y,
      width: p.width,
      height: p.height,
      position: p.position,
      content_length: p.content_length,
      viewport_length: p.viewport_length,
    });
  }
  return result;
}

/** Validates a browser → host scroll request. */
export function parseScrollRequest(
  message: unknown
): { pane: NativeScrollPaneKind; delta: number } | null {
  if (!message || typeof message !== "object") return null;
  const m = message as { pane?: unknown; delta?: unknown };
  if (m.pane !== "chat" && m.pane !== "side_panel") return null;
  if (
    typeof m.delta !== "number" ||
    !Number.isInteger(m.delta) ||
    m.delta === 0 ||
    Math.abs(m.delta) > MAX_DELTA
  ) {
    return null;
  }
  return { pane: m.pane, delta: m.delta };
}

function tmuxEnv(): NodeJS.ProcessEnv {
  const env = buildCliboxEnvironment();
  delete env.TMUX;
  delete env.TMUX_PANE;
  return env;
}

async function tmuxOutput(args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("tmux", args, { env: tmuxEnv() });
    return stdout;
  } catch {
    return null;
  }
}

/**
 * The socket path a session's apps will use. Sessions made before this
 * existed get one now; tmux hands it to panes and windows opened from here
 * on (a shell that is already running keeps its old environment).
 */
async function socketPathForSession(session: string): Promise<string | null> {
  const shown = await tmuxOutput([
    "show-environment",
    "-t",
    session,
    NATIVE_SCROLL_SOCKET_ENV,
  ]);
  const match = shown && /^[^=]+=(.+)$/m.exec(shown.trim());
  if (match && path.dirname(match[1]) === nativeScrollSocketDir()) {
    return match[1];
  }
  const socketPath = newNativeScrollSocketPath();
  const set = await tmuxOutput([
    "set-environment",
    "-t",
    session,
    NATIVE_SCROLL_SOCKET_ENV,
    socketPath,
  ]);
  return set === null ? null : socketPath;
}

/**
 * Native panes only describe the screen while the app owns the whole tmux
 * window: in a split, its coordinates are relative to its own pane, and in
 * the background it is not on screen at all.
 */
async function appIsOnScreen(session: string): Promise<boolean> {
  const out = await tmuxOutput([
    "display-message",
    "-p",
    "-t",
    session,
    "#{window_panes} #{pane_in_mode} #{pane_current_command}",
  ]);
  if (!out) return false;
  const [panes, inMode, command] = out.trim().split(" ");
  return panes === "1" && inMode === "0" && /jcode/i.test(command ?? "");
}

export interface NativeScrollBridge {
  scroll(pane: NativeScrollPaneKind, delta: number): void;
  close(): void;
}

interface Host {
  server: net.Server;
  clients: Set<net.Socket>;
  /** Connection whose panes were reported last: where scrolls go. */
  current: net.Socket | null;
  panes: NativeScrollPane[];
  listeners: Set<(panes: NativeScrollPane[]) => void>;
}

const hosts = new Map<string, Host>();

function broadcast(host: Host) {
  for (const listener of host.listeners) listener(host.panes);
}

function startHost(socketPath: string): Host | null {
  try {
    fs.mkdirSync(path.dirname(socketPath), { recursive: true, mode: 0o700 });
    fs.chmodSync(path.dirname(socketPath), 0o700);
    // A socket left by a previous server run blocks listen().
    fs.rmSync(socketPath, { force: true });
  } catch {
    return null;
  }

  const host: Host = {
    server: net.createServer(),
    clients: new Set(),
    current: null,
    panes: [],
    listeners: new Set(),
  };

  host.server.on("connection", (socket) => {
    host.clients.add(socket);
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (buffer.length > MAX_LINE_BYTES) {
        socket.destroy();
        return;
      }
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const panes = parsePaneSnapshot(line);
        if (!panes) continue;
        host.current = socket;
        host.panes = panes;
        broadcast(host);
      }
    });
    const drop = () => {
      host.clients.delete(socket);
      if (host.current === socket) {
        host.current = null;
        host.panes = [];
        broadcast(host);
      }
    };
    socket.on("close", drop);
    socket.on("error", drop);
  });
  host.server.on("error", () => undefined);
  host.server.listen(socketPath);
  return host;
}

function stopHost(socketPath: string, host: Host) {
  for (const socket of host.clients) socket.destroy();
  host.server.close();
  fs.rmSync(socketPath, { force: true });
  hosts.delete(socketPath);
}

/**
 * Relay native panes for a tmux session to one browser connection.
 * `onPanes` receives the panes whenever they change, or [] while the app is
 * gone or not the whole visible screen. Returns null when the session's
 * socket cannot be set up (touch scrolling then works as before).
 */
export async function attachNativeScroll(
  session: string,
  onPanes: (panes: NativeScrollPane[]) => void
): Promise<NativeScrollBridge | null> {
  const socketPath = await socketPathForSession(session);
  if (!socketPath) return null;

  let host = hosts.get(socketPath);
  if (!host) {
    const started = startHost(socketPath);
    if (!started) return null;
    host = started;
    hosts.set(socketPath, host);
  }
  const activeHost = host;

  let closed = false;
  let onScreen = false;
  let sent = "[]";
  const publish = () => {
    if (closed) return;
    const panes = onScreen ? activeHost.panes : [];
    const next = JSON.stringify(panes);
    if (next === sent) return;
    sent = next;
    onPanes(panes);
  };
  const checkScreen = async () => {
    const next = activeHost.panes.length > 0 && (await appIsOnScreen(session));
    if (next !== onScreen) {
      onScreen = next;
      publish();
    }
  };
  const listener = () => {
    publish();
    void checkScreen();
  };
  activeHost.listeners.add(listener);
  const timer = setInterval(() => {
    if (activeHost.panes.length > 0 || onScreen) void checkScreen();
  }, VISIBILITY_POLL_MS);
  listener();

  return {
    scroll(pane, delta) {
      if (closed || !onScreen || !activeHost.current) return;
      activeHost.current.write(
        `${JSON.stringify({ type: "scroll", pane, delta })}\n`
      );
    },
    close() {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      activeHost.listeners.delete(listener);
      if (activeHost.listeners.size === 0) stopHost(socketPath, activeHost);
    },
  };
}
