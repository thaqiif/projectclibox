"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import {
  TerminalSkeleton,
  FileExplorerSkeleton,
} from "@/components/Pane/PaneSkeletons";
import { tmuxAttachCommand } from "@/lib/tmux-attach";
import type { TerminalHandle } from "@/components/Terminal";
import type { TerminalRecord } from "@/lib/terminals";
import type { Project } from "@/lib/db";
import { cn } from "@/lib/utils";
import {
  dropSideFromRatio,
  MAX_MONITOR_PANES,
  type MonitorDropSide,
  type MonitorWorkspaceState,
} from "@/lib/monitor-workspace";
import { PANE_DRAG_TYPE, TERMINAL_DRAG_TYPE } from "@/lib/drag-types";
import { RotateCcw, TerminalSquare, X, FolderOpen } from "lucide-react";
import { useFileEditor } from "@/hooks/useFileEditor";

const Terminal = dynamic(
  () => import("@/components/Terminal").then((module) => module.Terminal),
  { ssr: false, loading: () => <TerminalSkeleton /> }
);

const FileExplorer = dynamic(
  () => import("@/components/FileExplorer").then((mod) => mod.FileExplorer),
  { ssr: false, loading: () => <FileExplorerSkeleton /> }
);

interface MonitorWorkspaceProps {
  workspace: MonitorWorkspaceState;
  terminals: TerminalRecord[];
  projects: Project[];
  onAssignTerminal: (
    paneId: string,
    terminalId: string,
    side?: MonitorDropSide
  ) => void;
  onMovePane: (
    sourcePaneId: string,
    anchorPaneId: string,
    side: MonitorDropSide
  ) => void;
  onRemovePane: (paneId: string) => void;
  onTerminalsChanged: () => Promise<void>;
}

function projectNameFor(
  terminal: TerminalRecord | undefined,
  projects: Project[]
): string | null {
  if (!terminal?.project_id) return null;
  const name = projects.find((project) => project.id === terminal.project_id)
    ?.name;
  if (!name || name === "Uncategorized") return null;
  return name;
}

function sideFromEvent(
  event: React.DragEvent,
  canInsert: boolean
): MonitorDropSide {
  const rect = event.currentTarget.getBoundingClientRect();
  if (rect.width <= 0) return "center";
  const side = dropSideFromRatio((event.clientX - rect.left) / rect.width);
  if (!canInsert && side !== "center") return "center";
  return side;
}

function MonitorTerminal({
  name,
  cwd,
  onRestarted,
}: {
  name: string;
  cwd?: string | null;
  onRestarted: () => Promise<void>;
}) {
  const ref = useRef<TerminalHandle | null>(null);
  const handleConnected = useCallback(() => {
    const handle = ref.current;
    if (!handle) return;
    setTimeout(() => {
      handle.sendCommand(tmuxAttachCommand(name, cwd));
      handle.focus();
      void onRestarted();
    }, 100);
  }, [name, cwd, onRestarted]);

  return <Terminal ref={ref} onConnected={handleConnected} workingDirectory={cwd} />;
}

function MonitorPane({
  paneId,
  terminal,
  terminalId,
  projectName,
  canRemove,
  canInsert,
  onAssign,
  onMove,
  onRemove,
  onTerminalsChanged,
}: {
  paneId: string;
  terminal?: TerminalRecord;
  terminalId: string | null;
  projectName: string | null;
  canRemove: boolean;
  canInsert: boolean;
  onAssign: (paneId: string, terminalId: string, side: MonitorDropSide) => void;
  onMove: (sourcePaneId: string, anchorPaneId: string, side: MonitorDropSide) => void;
  onRemove: (paneId: string) => void;
  onTerminalsChanged: () => Promise<void>;
}) {
  const [restart, setRestart] = useState(false);
  const [hoverSide, setHoverSide] = useState<MonitorDropSide | null>(null);
  const [hoverKind, setHoverKind] = useState<"terminal" | "pane" | null>(null);
  const [showFiles, setShowFiles] = useState(false);
  const fileEditor = useFileEditor();
  const occupied = Boolean(terminal && (terminal.alive || restart));
  const empty = !terminalId && !restart;

  const kindFromEvent = (event: React.DragEvent): "terminal" | "pane" | null => {
    const types = Array.from(event.dataTransfer.types);
    if (types.includes(PANE_DRAG_TYPE)) return "pane";
    if (types.includes(TERMINAL_DRAG_TYPE)) return "terminal";
    return null;
  };

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    const side = sideFromEvent(event, canInsert && !empty);
    setHoverSide(null);
    setHoverKind(null);
    const paneIdPayload = event.dataTransfer.getData(PANE_DRAG_TYPE);
    if (paneIdPayload) {
      onMove(paneIdPayload, paneId, side);
      return;
    }
    const terminalPayload = event.dataTransfer.getData(TERMINAL_DRAG_TYPE);
    if (terminalPayload) {
      setRestart(false);
      onAssign(paneId, terminalPayload, empty ? "center" : side);
    }
  };

  const title = terminal?.name ?? terminalId;

  // A different terminal in the pane means a different working directory
  // for Files, and a torn-down tmux attachment for the editor state.
  useEffect(() => {
    setShowFiles(false);
    fileEditor.reset();
  }, [terminalId]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      className="bg-background relative flex h-full min-w-0 flex-col overflow-hidden border border-[var(--fill-2)]"
      data-monitor-pane={paneId}
      onDragOver={(event) => {
        event.preventDefault();
        setHoverKind(kindFromEvent(event));
        setHoverSide(sideFromEvent(event, canInsert && !empty));
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          setHoverSide(null);
          setHoverKind(null);
        }
      }}
      onDrop={onDrop}
    >
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-[var(--fill-2)] px-2">
        <p
          draggable
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData(PANE_DRAG_TYPE, paneId);
          }}
          className="min-w-0 flex-1 cursor-grab truncate text-[0.75rem] font-medium active:cursor-grabbing"
        >
          {title ? (
            <>
              {title}
              {projectName && (
                <span className="text-muted-foreground font-normal">
                  {" · "}
                  {projectName}
                </span>
              )}
            </>
          ) : (
            <span className="text-muted-foreground font-normal">Empty pane</span>
          )}
        </p>
        {terminal && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Toggle file manager"
            className={cn("h-6 w-6 shrink-0", showFiles && "bg-[var(--fill-1)]")}
            onClick={() => setShowFiles((value) => !value)}
          >
            <FolderOpen className="h-3.5 w-3.5" />
          </Button>
        )}
        {canRemove && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Remove monitor pane"
            className="h-6 w-6 shrink-0"
            onClick={() => onRemove(paneId)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1">
        {showFiles && terminal?.working_directory ? (
          <FileExplorer
            workingDirectory={terminal.working_directory}
            fileEditor={fileEditor}
          />
        ) : (
          <>
        {terminal && (terminal.alive || restart) ? (
          <MonitorTerminal
            key={terminal.id}
            name={terminal.tmux_name}
            cwd={terminal.working_directory}
            onRestarted={onTerminalsChanged}
          />
        ) : restart && terminalId ? (
          <MonitorTerminal
            key={terminalId}
            name={terminalId}
            onRestarted={onTerminalsChanged}
          />
        ) : terminalId ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <TerminalSquare className="text-muted-foreground h-8 w-8" />
            <div>
              <p className="text-sm font-medium">{terminalId}</p>
              <p className="text-muted-foreground mt-1 text-xs">
                Terminal unavailable
              </p>
            </div>
            <Button size="sm" onClick={() => setRestart(true)}>
              <RotateCcw className="h-3.5 w-3.5" /> Restart
            </Button>
            <p className="text-muted-foreground text-xs">
              Drag another terminal here to replace it
            </p>
          </div>
        ) : (
          <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 border-2 border-dashed border-[var(--fill-3)] p-6 text-center text-sm">
            <TerminalSquare className="h-8 w-8" />
            <p>Drop a terminal here</p>
          </div>
        )}
          </>
        )}
      </div>
      {hoverSide && hoverKind && (
        <div className="pointer-events-none absolute inset-0 z-10">
          {hoverKind === "pane" || hoverSide !== "center" || empty ? (
            <div
              className={`h-full bg-primary/20 ${
                hoverSide === "center"
                  ? "w-full"
                  : hoverSide === "before"
                    ? "mr-auto w-1/4"
                    : "ml-auto w-1/4"
              }`}
            >
              <div className="flex h-full items-center justify-center px-2 text-center text-xs font-medium">
                {hoverKind === "pane"
                  ? "Move pane here"
                  : hoverSide === "center"
                    ? "Drop a terminal here"
                    : "Drop to open beside"}
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center bg-[var(--fill-1)]/80">
              <div className="rounded-lg border-2 border-dashed border-[var(--fill-3)] bg-background/90 px-4 py-3 text-center text-sm font-medium">
                Drop to replace this terminal
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function MonitorWorkspace({
  workspace,
  terminals,
  projects,
  onAssignTerminal,
  onMovePane,
  onRemovePane,
  onTerminalsChanged,
}: MonitorWorkspaceProps) {
  const canRemove = workspace.panes.length > 1;
  const canInsert = workspace.panes.length < MAX_MONITOR_PANES;
  return (
    <div className="flex h-full min-w-0">
      {workspace.panes.map((pane, index) => {
        const terminal = terminals.find(
          (candidate) => candidate.id === pane.terminalId
        );
        return (
          <Fragment key={pane.id}>
            {index > 0 && (
              <div className="w-px shrink-0 bg-[var(--fill-2)]" />
            )}
            <div className="min-w-0 flex-1">
              <MonitorPane
                paneId={pane.id}
                terminalId={pane.terminalId}
                terminal={terminal}
                projectName={projectNameFor(terminal, projects)}
                canRemove={canRemove}
                canInsert={canInsert}
                onAssign={onAssignTerminal}
                onMove={onMovePane}
                onRemove={onRemovePane}
                onTerminalsChanged={onTerminalsChanged}
              />
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
