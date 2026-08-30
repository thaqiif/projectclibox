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
import type { MonitorWorkspaceState } from "@/lib/monitor-workspace";
import { RotateCcw, TerminalSquare } from "lucide-react";

const Terminal = dynamic(
  () => import("@/components/Terminal").then((module) => module.Terminal),
  { ssr: false, loading: () => <TerminalSkeleton /> }
);

interface MonitorWorkspaceProps {
  workspace: MonitorWorkspaceState;
  terminals: TerminalRecord[];
  onAssignTerminal: (paneId: string, terminalId: string) => void;
  onResize: (layout: Record<string, number>) => void;
  onTerminalsChanged: () => Promise<void>;
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
  onAssign,
  onTerminalsChanged,
}: {
  paneId: string;
  terminal?: TerminalRecord;
  terminalId: string | null;
  onAssign: (paneId: string, terminalId: string) => void;
  onTerminalsChanged: () => Promise<void>;
}) {
  const [restart, setRestart] = useState(false);
  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    const id = event.dataTransfer.getData("application/x-cliweb-terminal");
    if (id) {
      // A fresh assignment cancels any pending restart of the old terminal.
      setRestart(false);
      onAssign(paneId, id);
    }
  };

  return (
    <div
      className="bg-background relative h-full min-w-0 overflow-hidden border border-[var(--fill-2)]"
      data-monitor-pane={paneId}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
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
        <div className="text-muted-foreground flex h-full items-center justify-center p-6 text-center text-sm">
          Drag a terminal here
        </div>
      )}
    </div>
  );
}

export function MonitorWorkspace({
  workspace,
  terminals,
  onAssignTerminal,
  onResize,
  onTerminalsChanged,
}: MonitorWorkspaceProps) {
  const defaultLayout = Object.fromEntries(
    workspace.panes.map((pane) => [pane.id, pane.width * 100])
  );
  return (
    <PanelGroup
      key={workspace.panes.map((pane) => pane.id).join(":")}
      orientation="horizontal"
      defaultLayout={defaultLayout}
      onLayoutChange={(layout: Layout) => onResize(layout)}
      className="h-full"
    >
      {workspace.panes.map((pane, index) => (
        <Fragment key={pane.id}>
          {index > 0 && (
            <PanelSeparator className="hover:bg-primary/40 relative w-px cursor-col-resize bg-[var(--fill-2)] after:absolute after:inset-y-0 after:-left-1 after:w-3 after:content-['']" />
          )}
          <Panel id={pane.id} minSize="15%">
            <MonitorPane
              paneId={pane.id}
              terminalId={pane.terminalId}
              terminal={terminals.find(
                (terminal) => terminal.id === pane.terminalId
              )}
              onAssign={onAssignTerminal}
              onTerminalsChanged={onTerminalsChanged}
            />
          </Panel>
        </Fragment>
      ))}
    </PanelGroup>
  );
}
