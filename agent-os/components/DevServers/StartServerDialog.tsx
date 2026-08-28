"use client";

import { useState, useEffect } from "react";
import { X, Server, Container, Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Project, ProjectDevServer } from "@/lib/db";

interface DetectedServer {
  type: "node" | "docker";
  name: string;
  command: string;
  ports: number[];
}

interface StartServerDialogProps {
  project: Project;
  projectDevServers?: ProjectDevServer[];
  onStart: (opts: {
    projectId: string;
    type: "node" | "docker";
    name: string;
    command: string;
    workingDirectory: string;
    ports?: number[];
  }) => Promise<void>;
  onClose: () => void;
}

export function StartServerDialog({
  project,
  projectDevServers = [],
  onStart,
  onClose,
}: StartServerDialogProps) {
  const [detected, setDetected] = useState<DetectedServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Custom server form state
  const [showCustom, setShowCustom] = useState(false);
  const [customType, setCustomType] = useState<"node" | "docker">("node");
  const [customName, setCustomName] = useState("");
  const [customCommand, setCustomCommand] = useState("");
  const [customPort, setCustomPort] = useState("3000");

  // Detect available servers
  useEffect(() => {
    async function detect() {
      try {
        const res = await fetch(
          `/api/dev-servers/detect?projectId=${project.id}`
        );
        if (res.ok) {
          const data = await res.json();
          setDetected(data.servers || []);
        }
      } catch (err) {
        console.error("Failed to detect servers:", err);
      } finally {
        setLoading(false);
      }
    }
    detect();
  }, [project.id]);

  const handleStartProjectServer = async (server: ProjectDevServer) => {
    setStarting(true);
    setError(null);
    try {
      await onStart({
        projectId: project.id,
        type: server.type,
        name: server.name,
        command: server.command,
        workingDirectory: project.working_directory,
        ports: server.port ? [server.port] : undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start server");
    } finally {
      setStarting(false);
    }
  };

  const handleStartDetected = async (server: DetectedServer) => {
    setStarting(true);
    setError(null);
    try {
      await onStart({
        projectId: project.id,
        type: server.type,
        name: server.name,
        command: server.command,
        workingDirectory: project.working_directory,
        ports: server.ports,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start server");
    } finally {
      setStarting(false);
    }
  };

  const handleStartCustom = async () => {
    if (!customName || !customCommand) {
      setError("Name and command are required");
      return;
    }

    setStarting(true);
    setError(null);
    try {
      const port = parseInt(customPort, 10);
      await onStart({
        projectId: project.id,
        type: customType,
        name: customName,
        command: customCommand,
        workingDirectory: project.working_directory,
        ports: isNaN(port) ? undefined : [port],
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start server");
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="overlay-in fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[3px]">
      <div
        className={cn(
          "flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden",
          "glass-thick glass-float lift-in rounded-2xl"
        )}
      >
        {/* Header */}
        <div className="edge-fade-bottom flex shrink-0 items-start justify-between gap-3 px-5 pt-4 pb-3">
          <div className="min-w-0">
            <h2 className="type-title-3 truncate">Start a dev server</h2>
            <p className="type-subhead text-muted-foreground truncate">
              {project.name}
            </p>
          </div>
          <button
            onClick={onClose}
            title="Close"
            aria-label="Close"
            className="press-sm focus-ring text-muted-foreground hover:text-foreground -mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--fill-3)] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto pb-1">
          {/* Registered servers */}
          {projectDevServers.length > 0 && (
            <div>
              <p className="ui-label px-5 pt-3">Registered</p>
              <div className="mt-1 pb-2">
                {projectDevServers.map((server) => (
                  <button
                    key={server.id}
                    onClick={() => handleStartProjectServer(server)}
                    disabled={starting}
                    className={cn(
                      "press-sm focus-ring hover:bg-[var(--fill-4)] group flex w-full items-center gap-2.5 px-5 py-2 text-left transition-colors",
                      "disabled:pointer-events-none disabled:opacity-50"
                    )}
                  >
                    {server.type === "docker" ? (
                      <Container className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <Server className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {server.name}
                      </span>
                      <span className="ui-meta block truncate">
                        $ {server.command}
                        {server.port && ` · ${server.port}`}
                      </span>
                    </span>
                    <Play className="text-primary h-3.5 w-3.5 shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Detected servers */}
          <div>
            <p className="ui-label px-5 pt-3">Detected</p>
            <div className="mt-1 pb-2">
              {loading ? (
                <div className="flex items-center gap-2 px-5 py-4">
                  <Loader2 className="text-muted-foreground h-3.5 w-3.5 animate-spin" />
                  <span className="type-subhead text-muted-foreground">
                    Scanning for dev servers
                  </span>
                </div>
              ) : detected.length > 0 ? (
                detected.map((server, i) => (
                  <button
                    key={i}
                    onClick={() => handleStartDetected(server)}
                    disabled={starting}
                    className={cn(
                      "press-sm focus-ring hover:bg-[var(--fill-4)] flex w-full items-center gap-2.5 px-5 py-2 text-left transition-colors",
                      "disabled:pointer-events-none disabled:opacity-50"
                    )}
                  >
                    {server.type === "docker" ? (
                      <Container className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                    ) : (
                      <Server className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {server.name}
                      </span>
                      <span className="ui-meta block truncate">
                        $ {server.command}
                        {server.ports.length > 0 && ` · ${server.ports[0]}`}
                      </span>
                    </span>
                    <Play className="text-primary h-3.5 w-3.5 shrink-0" />
                  </button>
                ))
              ) : (
                <p className="type-subhead text-muted-foreground px-5 py-3">
                  No dev servers detected
                </p>
              )}
            </div>
          </div>

          {/* Custom form */}
          {!showCustom ? (
            <div className="px-5 py-3">
              <button
                onClick={() => setShowCustom(true)}
                disabled={starting}
                className="press-sm focus-ring text-primary hover:text-primary/80 flex items-center gap-1.5 rounded-md text-[0.8125rem] font-medium transition-colors"
              >
                <Play className="h-3.5 w-3.5" />
                Add custom server
              </button>
            </div>
          ) : (
            <div className="space-y-4 px-5 py-4">
              <div className="flex items-stretch gap-2">
                <button
                  onClick={() => setCustomType("node")}
                  className={cn(
                    "press-sm focus-ring flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-[0.8125rem] font-medium transition-colors",
                    customType === "node"
                      ? "bg-primary/15 text-primary"
                      : "bg-[var(--fill-4)] text-foreground hover:bg-[var(--fill-3)]"
                  )}
                >
                  <Server className="h-3.5 w-3.5" />
                  Node.js
                </button>
                <button
                  onClick={() => setCustomType("docker")}
                  className={cn(
                    "press-sm focus-ring flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-[0.8125rem] font-medium transition-colors",
                    customType === "docker"
                      ? "bg-primary/15 text-primary"
                      : "bg-[var(--fill-4)] text-foreground hover:bg-[var(--fill-3)]"
                  )}
                >
                  <Container className="h-3.5 w-3.5" />
                  Docker
                </button>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="custom-server-name"
                  className="text-[0.8125rem] font-medium text-foreground"
                >
                  Name
                </label>
                <input
                  id="custom-server-name"
                  type="text"
                  placeholder="Server name"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  className={cn(
                    "focus-ring placeholder:text-muted-foreground/60 w-full rounded-lg border border-[var(--fill-2)] bg-[var(--fill-4)] px-3 py-2 text-[0.8125rem] outline-none transition-colors"
                  )}
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="custom-server-command"
                  className="text-[0.8125rem] font-medium text-foreground"
                >
                  Command
                </label>
                <input
                  id="custom-server-command"
                  type="text"
                  placeholder={
                    customType === "docker"
                      ? "Service name (e.g., web)"
                      : "Command (e.g., npm run dev)"
                  }
                  value={customCommand}
                  onChange={(e) => setCustomCommand(e.target.value)}
                  className={cn(
                    "focus-ring placeholder:text-muted-foreground/60 w-full rounded-lg border border-[var(--fill-2)] bg-[var(--fill-4)] px-3 py-2 font-mono text-[0.75rem] outline-none transition-colors"
                  )}
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-baseline gap-2">
                  <span className="text-[0.8125rem] font-medium text-foreground">
                    Directory
                  </span>
                  <span className="text-[0.8125rem] text-muted-foreground">
                    Fixed
                  </span>
                </div>
                <p className="ui-meta truncate rounded-lg bg-[var(--fill-4)] px-3 py-2">
                  {project.working_directory}
                </p>
              </div>

              {customType === "node" && (
                <div className="space-y-1.5">
                  <div className="flex items-baseline gap-2">
                    <label
                      htmlFor="custom-server-port"
                      className="text-[0.8125rem] font-medium text-foreground"
                    >
                      Port
                    </label>
                    <span className="text-[0.8125rem] text-muted-foreground">
                      Optional
                    </span>
                  </div>
                  <input
                    id="custom-server-port"
                    type="text"
                    placeholder="3000"
                    value={customPort}
                    onChange={(e) => setCustomPort(e.target.value)}
                    className={cn(
                      "focus-ring placeholder:text-muted-foreground/60 w-full rounded-lg border border-[var(--fill-2)] bg-[var(--fill-4)] px-3 py-2 font-mono text-[0.75rem] outline-none transition-colors"
                    )}
                  />
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {error && (
            <p className="type-subhead text-status-error flex items-center gap-2 px-5 py-3">
              <span className="bg-status-error animate-status-pulse h-1.5 w-1.5 shrink-0 rounded-full" />
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="edge-fade-top flex shrink-0 items-center justify-end gap-2 px-5 py-4">
          <Button
            onClick={onClose}
            disabled={starting}
            variant="outline"
            size="sm"
            className="h-9"
          >
            Cancel
          </Button>
          {showCustom && (
            <Button
              onClick={handleStartCustom}
              disabled={starting || !customName || !customCommand}
              size="sm"
              className="h-9"
            >
              {starting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Starting
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  Start server
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
