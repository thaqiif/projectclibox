"use client";

import { Fragment, useCallback, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  Group as PanelGroup,
  Panel,
  Separator as PanelSeparator,
  type Layout,
} from "react-resizable-panels";
import { Button } from "@/components/ui/button";
import { TerminalSkeleton } from "@/components/Pane/PaneSkeletons";
import { tmuxAttachCommand } from "@/lib/tmux-attach";
import type { TerminalHandle } from "@/components/Terminal";
import type { TerminalRecord } from "@/lib/terminals";
import type { Project } from "@/lib/db";
import type { MonitorWorkspaceState } from "@/lib/monitor-workspace";
import { RotateCcw, TerminalSquare, X } from "lucide-react";

const Terminal = dynamic(
  () => import("@/components/Terminal").then((module) => module.Terminal),
  { ssr: false, loading: () => <TerminalSkeleton /> }
);

interface MonitorWorkspaceProps {
  workspace: MonitorWorkspaceState;
  terminals: TerminalRecord[];
  projects: Project[];
  onAssignTerminal: (paneId: string, terminalId: string) => void;
  onRemovePane: (paneId: string) => void;
  onResize: (layout: Record<string, number>) => void;
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

  return <Terminal ref={ref} onConnected={handleConnected} />;
}

function MonitorPane({
  paneId,
  terminal,
  terminalId,
  projectName,
  canRemove,
  onAssign,
  onRemove,
  onTerminalsChanged,
}: {
  paneId: string;
  terminal?: TerminalRecord;
  terminalId: string | null;
  projectName: string | null;
  canRemove: boolean;
  onAssign: (paneId: string, terminalId: string) => void;
  onRemove: (paneId: string) => void;
  onTerminalsChanged: () => Promise<void>;
}) {
  const [restart, setRestart] = useState(false);
  const [isOver, setIsOver] = useState(false);
  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setIsOver(false);
    const id = event.dataTransfer.getData("application/x-cliweb-terminal");
    if (id) {
      // A fresh assignment cancels any pending restart of the old terminal.
      setRestart(false);
      onAssign(paneId, id);
    }
  };

  const title = terminal?.name ?? terminalId;
  const occupied = Boolean(terminal && (terminal.alive || restart));

  return (
    <div
      className="bg-background relative flex h-full min-w-0 flex-col overflow-hidden border border-[var(--fill-2)]"
      data-monitor-pane={paneId}
      onDragOver={(event) => {
        event.preventDefault();
        setIsOver(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          setIsOver(false);
        }
      }}
      onDrop={onDrop}
    >
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-[var(--fill-2)] px-2">
        <p className="min-w-0 flex-1 truncate text-[0.75rem] font-medium">
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
      </div>
      {isOver && occupied && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-[var(--fill-1)]/80">
          <div className="rounded-lg border-2 border-dashed border-[var(--fill-3)] bg-background/90 px-4 py-3 text-center text-sm font-medium">
            Drop to replace this terminal
          </div>
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
  onRemovePane,
  onResize,
  onTerminalsChanged,
}: MonitorWorkspaceProps) {
  const defaultLayout = Object.fromEntries(
    workspace.panes.map((pane) => [pane.id, pane.width * 100])
  );
  const canRemove = workspace.panes.length > 1;
  return (
    <PanelGroup
      key={workspace.panes.map((pane) => pane.id).join(":")}
      orientation="horizontal"
      defaultLayout={defaultLayout}
      onLayoutChange={(layout: Layout) => onResize(layout)}
      className="h-full"
    >
      {workspace.panes.map((pane, index) => {
        const terminal = terminals.find(
          (candidate) => candidate.id === pane.terminalId
        );
        return (
          <Fragment key={pane.id}>
            {index > 0 && (
              <PanelSeparator className="hover:bg-primary/40 relative w-px cursor-col-resize bg-[var(--fill-2)] after:absolute after:inset-y-0 after:-left-1 after:w-3 after:content-['']" />
            )}
            <Panel id={pane.id} minSize="15%">
              <MonitorPane
                paneId={pane.id}
                terminalId={pane.terminalId}
                terminal={terminal}
                projectName={projectNameFor(terminal, projects)}
                canRemove={canRemove}
                onAssign={onAssignTerminal}
                onRemove={onRemovePane}
                onTerminalsChanged={onTerminalsChanged}
              />
            </Panel>
          </Fragment>
        );
      })}
    </PanelGroup>
  );
}
