import "next/dist/server/node-environment";
import { createServer } from "http";
import type { Duplex } from "stream";
import { parse } from "url";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";
import * as pty from "node-pty";
import { buildCliwebEnvironment } from "./lib/runtime-environment";
import {
  consumeTerminalCapability,
  releaseTerminalCapability,
  type TerminalCapability,
} from "./lib/terminal-capabilities";
import { isAllowedOrigin } from "./lib/route-guards";
import { isValidTerminalGrid } from "./lib/terminal-grid";
import {
  decodeTerminalResourceFrame,
  encodeTerminalResourceFrame,
  TERMINAL_RESOURCE_MAX_FRAME_BYTES,
  TERMINAL_RESOURCE_PROTOCOL_VERSION,
} from "./lib/terminal-resource-protocol";
import {
  parseTerminalResourceRequest,
  transferTerminalResource,
} from "./lib/terminal-resource-server";

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const MAX_RESOURCE_JOBS_PER_PTY = 4;
const MAX_RESOURCE_JOBS_SERVER_WIDE = 8;
const MAX_QUEUED_RESOURCE_BYTES = 64 * 1024 * 1024;
const MAX_SOCKET_RESOURCE_BUFFER_BYTES = 8 * 1024 * 1024;
let activeResourceJobs = 0;
let queuedResourceBytes = 0;

// Support: npm run dev -- -p 3012
const pFlagIndex = process.argv.indexOf("-p");
const portArg = pFlagIndex !== -1 ? process.argv[pFlagIndex + 1] : undefined;
const port = parseInt(portArg || process.env.PORT || "3011", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function rejectUpgrade(socket: Duplex, status: number, text: string) {
  socket.write(
    `HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`
  );
  socket.destroy();
}

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url!, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error("Error occurred handling", req.url, err);
      res.statusCode = 500;
      res.end("internal server error");
    }
  });

  const terminalWss = new WebSocketServer({
    noServer: true,
    maxPayload: 1024 * 1024,
    perMessageDeflate: false,
  });
  const pendingHello = new Set<WebSocket>();

  server.on("upgrade", (request, socket, head) => {
    const { pathname } = parse(request.url || "");
    if (pathname !== "/ws/terminal") return;

    const allowed = isAllowedOrigin(
      firstHeader(request.headers.origin),
      firstHeader(request.headers.host),
      firstHeader(request.headers["x-forwarded-host"])
    );
    if (!allowed) {
      rejectUpgrade(socket, 403, "Forbidden");
      return;
    }
    if (pendingHello.size >= 32) {
      rejectUpgrade(socket, 503, "Service Unavailable");
      return;
    }

    terminalWss.handleUpgrade(request, socket, head, (ws) => {
      pendingHello.add(ws);
      terminalWss.emit("connection", ws, request);
    });
  });

  terminalWss.on("connection", (ws: WebSocket) => {
    let ptyProcess: pty.IPty | null = null;
    let attachedCapability: TerminalCapability | null = null;
    let helloReceived = false;
    const resourceJobs = new Map<number, AbortController>();
    let helloTimer: NodeJS.Timeout | null = null;

    const releasePendingHello = () => {
      if (pendingHello.delete(ws) && helloTimer) {
        clearTimeout(helloTimer);
        helloTimer = null;
      }
    };

    helloTimer = setTimeout(() => {
      if (ptyProcess) return;
      releasePendingHello();
      ws.send(
        JSON.stringify({ type: "error", message: "Terminal hello timed out" })
      );
      ws.close(1008, "Hello timed out");
    }, 5_000);

    const rejectHello = (message: string) => {
      releasePendingHello();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "error", message }));
        ws.close(1008, "Invalid terminal hello");
      }
    };

    const releaseCapability = () => {
      const capability = attachedCapability;
      attachedCapability = null;
      if (capability) void releaseTerminalCapability(capability);
    };

    const sendResourceFrame = async (
      header: Record<string, unknown>,
      bytes: Uint8Array<ArrayBufferLike> = new Uint8Array(),
      signal?: AbortSignal
    ): Promise<void> => {
      if (ws.readyState !== WebSocket.OPEN || signal?.aborted) {
        throw new Error("Terminal resource connection is closed");
      }
      const frame = encodeTerminalResourceFrame(header, bytes);
      if (frame.byteLength > 4 * 1024 + 4 + TERMINAL_RESOURCE_MAX_FRAME_BYTES) {
        throw new Error("Terminal resource frame is oversized");
      }

      const backpressureDeadline = Date.now() + 5_000;
      while (ws.bufferedAmount > MAX_SOCKET_RESOURCE_BUFFER_BYTES) {
        if (Date.now() > backpressureDeadline) {
          throw new Error("Terminal resource socket remained backpressured");
        }
        if (ws.readyState !== WebSocket.OPEN || signal?.aborted) {
          throw new Error("Terminal resource connection is closed");
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      if (queuedResourceBytes + frame.byteLength > MAX_QUEUED_RESOURCE_BYTES) {
        throw new Error("Terminal resource server is overloaded");
      }

      queuedResourceBytes += frame.byteLength;
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (error?: Error) => {
          if (settled) return;
          settled = true;
          queuedResourceBytes -= frame.byteLength;
          if (error) reject(error);
          else resolve();
        };
        try {
          ws.send(frame, { binary: true }, (error) => finish(error));
        } catch (error) {
          finish(
            error instanceof Error ? error : new Error("WebSocket send failed")
          );
        }
      });
    };

    const handleResourceFrame = (data: Buffer | ArrayBuffer | Buffer[]) => {
      let frame: ReturnType<typeof decodeTerminalResourceFrame>;
      try {
        const bytes = Array.isArray(data)
          ? Buffer.concat(data)
          : data instanceof ArrayBuffer
            ? data
            : data;
        frame = decodeTerminalResourceFrame(bytes);
      } catch {
        ws.close(1002, "Invalid terminal resource frame");
        ptyProcess?.kill();
        return;
      }

      const { header, bytes } = frame;
      if (
        header.version !== TERMINAL_RESOURCE_PROTOCOL_VERSION ||
        bytes.byteLength !== 0
      ) {
        ws.close(1002, "Invalid terminal resource frame");
        ptyProcess?.kill();
        return;
      }

      if (header.type === "cancel") {
        if (
          typeof header.id !== "number" ||
          !Number.isSafeInteger(header.id) ||
          header.id <= 0
        ) {
          ws.close(1002, "Invalid terminal resource cancellation");
          ptyProcess?.kill();
          return;
        }
        resourceJobs.get(header.id)?.abort();
        void sendResourceFrame({
          version: TERMINAL_RESOURCE_PROTOCOL_VERSION,
          type: "cancelled",
          id: header.id,
        }).catch(() => {});
        return;
      }

      if (header.type !== "request" || !attachedCapability) {
        ws.close(1002, "Unexpected terminal resource frame");
        ptyProcess?.kill();
        return;
      }

      let request;
      try {
        request = parseTerminalResourceRequest(header);
      } catch {
        ws.close(1002, "Invalid terminal resource request");
        ptyProcess?.kill();
        return;
      }
      if (resourceJobs.has(request.id)) {
        ws.close(1002, "Duplicate terminal resource request");
        ptyProcess?.kill();
        return;
      }
      if (
        resourceJobs.size >= MAX_RESOURCE_JOBS_PER_PTY ||
        activeResourceJobs >= MAX_RESOURCE_JOBS_SERVER_WIDE
      ) {
        void sendResourceFrame({
          version: TERMINAL_RESOURCE_PROTOCOL_VERSION,
          type: "rejected",
          id: request.id,
          reason: "Terminal resource service is busy",
        }).catch(() => {});
        return;
      }

      const controller = new AbortController();
      resourceJobs.set(request.id, controller);
      activeResourceJobs++;
      void transferTerminalResource(
        request,
        attachedCapability,
        controller.signal,
        (reply, payload) => sendResourceFrame(reply, payload, controller.signal)
      ).finally(() => {
        if (resourceJobs.get(request.id) === controller) {
          resourceJobs.delete(request.id);
          activeResourceJobs--;
        }
      });
    };

    ws.on("message", async (message, isBinary) => {
      if (!ptyProcess) {
        if (helloReceived) {
          rejectHello("Only one terminal hello is allowed");
          return;
        }
        helloReceived = true;
        if (isBinary) {
          rejectHello("Binary messages are not available on this connection");
          return;
        }

        let hello: {
          type?: unknown;
          token?: unknown;
          cols?: unknown;
          rows?: unknown;
        };
        try {
          hello = JSON.parse(message.toString());
        } catch {
          rejectHello("Malformed terminal hello");
          return;
        }
        if (!hello || typeof hello !== "object" || Array.isArray(hello)) {
          rejectHello("Malformed terminal hello");
          return;
        }
        const grid = { cols: hello.cols, rows: hello.rows };
        if (hello.type !== "hello" || !isValidTerminalGrid(grid)) {
          rejectHello("Invalid terminal dimensions");
          return;
        }

        const capability = await consumeTerminalCapability(hello.token, grid);
        if (ws.readyState !== WebSocket.OPEN) {
          if (capability) await releaseTerminalCapability(capability);
          return;
        }
        if (!capability) {
          rejectHello("Terminal capability expired or is no longer valid");
          return;
        }

        try {
          const shellEnv = buildCliwebEnvironment();
          delete shellEnv.TMUX;
          delete shellEnv.TMUX_PANE;
          const terminalEnv: { [key: string]: string } = {
            ...shellEnv,
            TERM: "xterm-256color",
            COLORTERM: "truecolor",
          };

          ptyProcess = pty.spawn(
            "tmux",
            ["attach-session", "-t", capability.sessionId],
            {
              name: "xterm-256color",
              cols: grid.cols,
              rows: grid.rows,
              cwd: capability.cwd,
              env: terminalEnv,
            }
          );
          attachedCapability = capability;
        } catch (err) {
          console.error("Failed to spawn tmux client PTY:", err);
          await releaseTerminalCapability(capability);
          rejectHello("Failed to attach terminal session");
          return;
        }

        releasePendingHello();
        ws.send(JSON.stringify({ type: "ready" }));

        ptyProcess.onData((data: string) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          if (ws.bufferedAmount > 4 * 1024 * 1024) {
            ws.close(1013, "Terminal output backpressure limit exceeded");
            ptyProcess?.kill();
            return;
          }
          ws.send(JSON.stringify({ type: "output", data }));
        });

        ptyProcess.onExit(({ exitCode }) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "exit", code: exitCode }));
            ws.close();
          }
        });
        return;
      }

      if (isBinary) {
        handleResourceFrame(message as Buffer | ArrayBuffer | Buffer[]);
        return;
      }

      try {
        const msg = JSON.parse(message.toString());
        switch (msg.type) {
          case "input":
            if (typeof msg.data === "string") ptyProcess.write(msg.data);
            break;
          case "resize":
            if (!isValidTerminalGrid({ cols: msg.cols, rows: msg.rows })) {
              ws.close(1008, "Invalid terminal dimensions");
              ptyProcess.kill();
              return;
            }
            ptyProcess.resize(msg.cols, msg.rows);
            break;
          case "command":
            if (typeof msg.data === "string") ptyProcess.write(msg.data + "\r");
            break;
        }
      } catch (err) {
        console.error("Error parsing terminal message:", err);
      }
    });

    ws.on("close", () => {
      releasePendingHello();
      if (helloTimer) clearTimeout(helloTimer);
      for (const controller of resourceJobs.values()) controller.abort();
      const jobCount = resourceJobs.size;
      resourceJobs.clear();
      activeResourceJobs = Math.max(0, activeResourceJobs - jobCount);
      ptyProcess?.kill();
      releaseCapability();
    });

    ws.on("error", (err) => {
      console.error("WebSocket error:", err);
      releasePendingHello();
      for (const controller of resourceJobs.values()) controller.abort();
      const jobCount = resourceJobs.size;
      resourceJobs.clear();
      activeResourceJobs = Math.max(0, activeResourceJobs - jobCount);
      ptyProcess?.kill();
      releaseCapability();
    });
  });

  server.listen(port, () => {
    console.log(`> CLIWeb ready on http://${hostname}:${port}`);
  });
});
