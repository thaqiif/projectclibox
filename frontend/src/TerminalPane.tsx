import { memo, useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { AUTH_REQUIRED_EVENT, AUTH_RESTORED_EVENT } from "./api";
import type { Session, SessionStatus } from "./protocol";
import { decodeOutputFrame } from "./protocol";

interface TerminalPaneProps {
  session: Session;
  compact?: boolean;
  onSessionUpdate: (id: string, update: Partial<Session>) => void;
}

type ConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected";

export const TerminalPane = memo(function TerminalPane({
  session,
  compact = false,
  onSessionUpdate,
}: TerminalPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sequenceRef = useRef(0);
  const retryRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const intentionalCloseRef = useRef(false);
  const sessionIdRef = useRef(session.id);
  const sessionStatusRef = useRef<SessionStatus>(session.status);
  const attachFailedRef = useRef(false);
  const updateRef = useRef(onSessionUpdate);
  const [connection, setConnection] = useState<ConnectionState>("connecting");

  updateRef.current = onSessionUpdate;
  sessionIdRef.current = session.id;
  if (!attachFailedRef.current) sessionStatusRef.current = session.status;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    intentionalCloseRef.current = false;
    attachFailedRef.current = false;
    sequenceRef.current = 0;
    retryRef.current = 0;
    const term = new Terminal({
      cursorBlink: true,
      convertEol: false,
      scrollback: 5000,
      allowProposedApi: true,
      fontFamily: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: compact ? 12 : 13,
      lineHeight: 1.15,
      theme: {
        background: "#09111f",
        foreground: "#d7e6f5",
        cursor: "#a7eadc",
        selectionBackground: "#345168",
        black: "#142238",
        red: "#f5b6a6",
        green: "#a7eadc",
        yellow: "#f3d495",
        blue: "#afcdf6",
        magenta: "#c7b8f5",
        cyan: "#91d7ea",
        white: "#d7e6f5",
        brightBlack: "#5d7791",
        brightWhite: "#f4f8fb",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    termRef.current = term;
    fitRef.current = fit;

    let resizeObserver: ResizeObserver | null = null;
    const send = (message: unknown) => {
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    };
    const fitAndResize = () => {
      try {
        fit.fit();
        if (term.cols > 0 && term.rows > 0) send({ type: "terminal.resize", cols: term.cols, rows: term.rows });
      } catch {
        // The container can be hidden while a monitor pane is being rearranged.
      }
    };
    resizeObserver = new ResizeObserver(fitAndResize);
    resizeObserver.observe(container);
    const inputDisposable = term.onData((data) => send({ type: "terminal.input", data }));

    const connect = () => {
      if (intentionalCloseRef.current) return;
      if (socketRef.current && (socketRef.current.readyState === WebSocket.CONNECTING || socketRef.current.readyState === WebSocket.OPEN)) return;
      setConnection(retryRef.current === 0 ? "connecting" : "reconnecting");
      const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${scheme}//${window.location.host}/ws/terminal`);
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;
      socket.onopen = () => {
        retryRef.current = 0;
        setConnection("connected");
        socket.send(JSON.stringify({
          type: "terminal.attach",
          sessionId: sessionIdRef.current,
          fromSequence: sequenceRef.current,
        }));
        fitAndResize();
        term.focus();
      };
      socket.onmessage = (event) => {
        if (typeof event.data === "string") {
          try {
            const message = JSON.parse(event.data) as {
              type: string;
              code?: string;
              snapshot?: Session;
              truncated?: boolean;
              resyncRequired?: boolean;
            };
            if (message.type === "terminal.ready") {
              if (message.snapshot) sessionStatusRef.current = message.snapshot.status;
              if (message.truncated) term.write("\r\n\x1b[33m[Older output was truncated]\x1b[0m\r\n");
              // The server sends replay metadata before the replay frames.
              // Advance only when a binary frame is actually consumed.
              if (message.snapshot) updateRef.current(sessionIdRef.current, message.snapshot);
            } else if (message.type === "terminal.state" && message.snapshot) {
              sessionStatusRef.current = message.snapshot.status;
              updateRef.current(sessionIdRef.current, message.snapshot);
            } else if (message.type === "terminal.exit") {
              sessionStatusRef.current = "exited";
              updateRef.current(sessionIdRef.current, { status: "exited" as SessionStatus });
            } else if (message.type === "terminal.gap" && message.resyncRequired) {
              sequenceRef.current = 0;
              term.clear();
              term.write("\x1b[33m[Viewer fell behind; replaying retained output]\x1b[0m\r\n");
              socket.close();
            } else if (message.type === "terminal.error") {
              if (message.code === "attach_failed") {
                attachFailedRef.current = true;
                sessionStatusRef.current = "failed";
                updateRef.current(sessionIdRef.current, { status: "failed" as SessionStatus });
                setConnection("disconnected");
              }
              term.write(`\r\n\x1b[31m[${message.type}] ${JSON.stringify(message)}\x1b[0m\r\n`);
            }
          } catch {
            term.write(event.data);
          }
          return;
        }
        const frame = decodeOutputFrame(event.data as ArrayBuffer);
        if (!frame || frame.sequence <= sequenceRef.current) return;
        sequenceRef.current = frame.sequence;
        term.write(frame.text);
      };
      socket.onerror = () => socket.close();
      socket.onclose = () => {
        if (socketRef.current === socket) socketRef.current = null;
        if (intentionalCloseRef.current) {
          setConnection("disconnected");
          return;
        }
        if (["exited", "failed"].includes(sessionStatusRef.current)) {
          setConnection("disconnected");
          return;
        }
        void scheduleReconnect();
      };
    };

    const scheduleReconnect = async () => {
      if (intentionalCloseRef.current || ["exited", "failed"].includes(sessionStatusRef.current)) return;
      try {
        const response = await fetch("/api/terminals", { credentials: "same-origin" });
        if (response.status === 401) {
          window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
          setConnection("disconnected");
          return;
        }
      } catch {
        // The original WebSocket failure is enough to schedule a retry; the
        // probe only exists to surface an expired optional app-auth cookie.
      }
      if (intentionalCloseRef.current || ["exited", "failed"].includes(sessionStatusRef.current)) return;
      if (socketRef.current) return;
      setConnection("reconnecting");
      const delay = Math.min(500 * 2 ** retryRef.current, 8000);
      retryRef.current += 1;
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, delay);
    };
    const reconnectAfterAuth = () => {
      if (intentionalCloseRef.current || ["exited", "failed"].includes(sessionStatusRef.current)) return;
      if (socketRef.current && (socketRef.current.readyState === WebSocket.CONNECTING || socketRef.current.readyState === WebSocket.OPEN)) return;
      if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
      retryRef.current = 0;
      connect();
    };
    window.addEventListener(AUTH_RESTORED_EVENT, reconnectAfterAuth);
    connect();

    return () => {
      intentionalCloseRef.current = true;
      if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current);
      window.removeEventListener(AUTH_RESTORED_EVENT, reconnectAfterAuth);
      resizeObserver?.disconnect();
      inputDisposable.dispose();
      socketRef.current?.close(1000, "viewer detached");
      socketRef.current = null;
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [compact, session.id]);

  return (
    <div className="terminal-shell">
      <div className={`connection-badge connection-${connection}`} aria-live="polite">
        <span className="status-dot" />
        {connection === "connected" ? "Live" : connection === "reconnecting" ? "Reconnecting" : connection}
      </div>
      <div ref={containerRef} className="terminal-canvas" />
    </div>
  );
});
