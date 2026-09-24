import "next/dist/server/node-environment";
import { createServer } from "http";
import type { Duplex } from "stream";
import { parse } from "url";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";
import * as pty from "node-pty";
import { buildCliwebEnvironment } from "./lib/runtime-environment";
import { consumeTerminalCapability } from "./lib/terminal-capabilities";
import { isAllowedOrigin } from "./lib/route-guards";
import { isValidTerminalGrid } from "./lib/terminal-grid";

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";

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
    let helloReceived = false;
    let helloTimer: NodeJS.Timeout | null = setTimeout(() => {
      if (ptyProcess) return;
      ws.send(JSON.stringify({ type: "error", message: "Terminal hello timed out" }));
      ws.close(1008, "Hello timed out");
    }, 5_000);

    const releasePendingHello = () => {
      if (pendingHello.delete(ws) && helloTimer) {
        clearTimeout(helloTimer);
        helloTimer = null;
      }
    };

    const rejectHello = (message: string) => {
      releasePendingHello();
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "error", message }));
        ws.close(1008, "Invalid terminal hello");
      }
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

        let hello: { type?: unknown; token?: unknown; cols?: unknown; rows?: unknown };
        try {
          hello = JSON.parse(message.toString());
        } catch {
          rejectHello("Malformed terminal hello");
          return;
        }
        const grid = { cols: hello.cols, rows: hello.rows };
        if (hello.type !== "hello" || !isValidTerminalGrid(grid)) {
          rejectHello("Invalid terminal dimensions");
          return;
        }

        const capability = await consumeTerminalCapability(hello.token, grid);
        if (ws.readyState !== WebSocket.OPEN) return;
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
        } catch (err) {
          console.error("Failed to spawn tmux client PTY:", err);
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
        ws.close(1003, "Unsupported binary terminal frame");
        ptyProcess.kill();
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
      ptyProcess?.kill();
    });

    ws.on("error", (err) => {
      console.error("WebSocket error:", err);
      releasePendingHello();
      ptyProcess?.kill();
    });
  });

  server.listen(port, () => {
    console.log(`> CLIWeb ready on http://${hostname}:${port}`);
  });
});
