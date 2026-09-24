"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  TerminalSkeleton,
  FileExplorerSkeleton,
} from "@/components/Pane/PaneSkeletons";
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
import {
  Columns3,
  FolderOpen,
  ListPlus,
  Menu,
  Plus,
  RotateCcw,
  TerminalSquare,
  X,
} from "lucide-react";
import { useFileEditor } from "@/hooks/useFileEditor";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
  mobile?: boolean;
  activePaneId?: string | null;
  onSelectPane?: (paneId: string) => void;
  onAddPane?: () => string | undefined;
  onCreateTerminal?: (paneId: string) => void | Promise<void>;
  onToggleMonitor?: () => void;
  onMenuClick?: () => void;
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
  onTitle,
  restart = false,
  isActive,
}: {
  name: string;
  cwd?: string | null;
  onRestarted: () => Promise<void>;
  onTitle: (title: string) => void;
  restart?: boolean;
  isActive: boolean;
}) {
  const ref = useRef<TerminalHandle | null>(null);
  const [retry, setRetry] = useState(0);
  const requestKey = restart ? `${name}:${retry}` : "idle";
  const [startupState, setStartupState] = useState<{
    requestKey: string;
    value: "restarting" | "ready" | "error";
  }>({
    requestKey,
    value: restart ? "restarting" : "ready",
  });
  const startup =
    startupState.requestKey === requestKey
      ? startupState.value
      : restart
        ? "restarting"
        : "ready";
  useEffect(() => {
    if (!restart) return;
    let cancelled = false;
    void fetch(`/api/terminals/${encodeURIComponent(name)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Terminal restart failed");
        if (cancelled) return;
        await onRestarted();
        if (!cancelled) setStartupState({ requestKey, value: "ready" });
      })
      .catch(() => {
        if (!cancelled) setStartupState({ requestKey, value: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [name, onRestarted, requestKey, restart]);

  if (startup !== "ready") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm font-medium">
          {startup === "restarting" ? "Restarting terminal…" : "Terminal restart failed"}
        </p>
        {startup === "error" && (
          <Button size="sm" onClick={() => setRetry((value) => value + 1)}>
            Retry
          </Button>
        )}
      </div>
    );
  }

  return (
    <Terminal
      ref={ref}
      sessionName={name}
      isActive={isActive}
      onTitle={onTitle}
      workingDirectory={cwd}
    />
  );
}

function MonitorPane({
  paneId,
  terminal,
  terminalId,
  projectName,
  canRemove,
  canInsert,
  mobile,
  isActive,
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
  mobile: boolean;
  isActive: boolean;
  onAssign: (paneId: string, terminalId: string, side: MonitorDropSide) => void;
  onMove: (sourcePaneId: string, anchorPaneId: string, side: MonitorDropSide) => void;
  onRemove: (paneId: string) => void;
  onTerminalsChanged: () => Promise<void>;
}) {
  const [restart, setRestart] = useState(false);
  const [hoverSide, setHoverSide] = useState<MonitorDropSide | null>(null);
  const [hoverKind, setHoverKind] = useState<"terminal" | "pane" | null>(null);
  const [showFiles, setShowFiles] = useState(false);
  const [terminalTitleState, setTerminalTitleState] = useState<{
    terminalId: string | null;
    restart: boolean;
    title: string | null;
  }>({ terminalId, restart, title: null });
  const fileEditor = useFileEditor();
  const { reset: resetFileEditor } = fileEditor;
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

  const terminalTitle =
    terminalTitleState.terminalId === terminalId &&
    terminalTitleState.restart === restart
      ? terminalTitleState.title
      : null;
  const handleTerminalTitle = useCallback(
    (title: string) => setTerminalTitleState({ terminalId, restart, title }),
    [terminalId, restart]
  );
  const title = terminalTitle?.trim() || terminal?.name || terminalId;

  // A different terminal in the pane means a different working directory
  // for Files, and a torn-down tmux attachment for the editor state.
  // Derived-reset pattern (same idiom as the listing's selection reset):
  // fold state during render instead of an effect, so a terminal swap is
  // reflected in the same commit rather than one render later.
  const [prevTerminalId, setPrevTerminalId] = useState(terminalId);
  if (prevTerminalId !== terminalId) {
    setPrevTerminalId(terminalId);
    setShowFiles(false);
  }
  useEffect(() => {
    resetFileEditor();
  }, [terminalId, resetFileEditor]);

  // Pane teardown: when this pane unmounts (removed, its terminal dragged
  // out into the sidebar, or the workspace closed), drop its open-file
  // tabs and dirty state. Without this, an unmounted pane's openFiles
  // leak for the rest of the session and reappear if another pane opens
  // the same path.
  useEffect(() => {
    return () => resetFileEditor();
  }, [resetFileEditor]);

  return (
    <div
      className="bg-background relative flex h-full min-w-0 w-full flex-col overflow-hidden border border-[var(--fill-2)]"
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
      <div
        className={cn(
          "flex shrink-0 items-center gap-2 border-b border-[var(--fill-2)] px-2",
          mobile ? "h-11" : "h-8"
        )}
      >
        <p
          draggable={!mobile}
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
        {/* Only offer Files when the terminal has a usable working directory;
            without one the explorer would render nothing and the toggle
            would look stuck on (active fill, no view). */}
        {terminal && terminal.working_directory && (
          <Button
            variant="ghost"
            size={mobile ? "icon" : "icon-sm"}
            aria-label="Toggle file manager"
            className={cn(
              "shrink-0",
              mobile ? "h-11 w-11" : "h-6 w-6",
              showFiles && "bg-[var(--fill-1)]"
            )}
            onClick={() => setShowFiles((value) => !value)}
          >
            <FolderOpen className="h-3.5 w-3.5" />
          </Button>
        )}
        {canRemove && (
          <Button
            variant="ghost"
            size={mobile ? "icon" : "icon-sm"}
            aria-label="Remove monitor pane"
            className={cn("shrink-0", mobile ? "h-11 w-11" : "h-6 w-6")}
            onClick={() => onRemove(paneId)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      <div className="min-h-0 min-w-0 w-full flex-1">
        {showFiles && terminal?.working_directory ? (
          <FileExplorer
            workingDirectory={terminal.working_directory}
            fileEditor={fileEditor}
            responsiveToContainer
          />
        ) : (
          <>
        {terminal && (terminal.alive || restart) ? (
          <MonitorTerminal
            key={terminal.id}
            name={terminal.tmux_name}
            cwd={terminal.working_directory}
            onRestarted={onTerminalsChanged}
            onTitle={handleTerminalTitle}
            restart={restart}
            isActive={isActive}
          />
        ) : restart && terminalId ? (
          <MonitorTerminal
            key={terminalId}
            name={terminalId}
            onRestarted={onTerminalsChanged}
            onTitle={handleTerminalTitle}
            restart
            isActive={isActive}
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
              {mobile
                ? "Use Add to monitor to choose a terminal"
                : "Drag another terminal here to replace it"}
            </p>
          </div>
        ) : (
          <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 border-2 border-dashed border-[var(--fill-3)] p-6 text-center text-sm">
            <TerminalSquare className="h-8 w-8" />
            <p>
              {mobile
                ? "Use Add to monitor to choose a terminal"
                : "Drop a terminal here"}
            </p>
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
  mobile = false,
  activePaneId,
  onSelectPane,
  onAddPane,
  onCreateTerminal,
  onToggleMonitor,
  onMenuClick,
}: MonitorWorkspaceProps) {
  const canRemove = workspace.panes.length > 1;
  const occupiedPaneCount = workspace.panes.filter(
    (pane) => pane.terminalId !== null
  ).length;
  const canInsert = occupiedPaneCount < MAX_MONITOR_PANES;
  const selectedPaneId = workspace.panes.some(
    (pane) => pane.id === activePaneId
  )
    ? activePaneId
    : workspace.panes[0]?.id;
  const selectedPane = workspace.panes.find(
    (pane) => pane.id === selectedPaneId
  );
  const [terminalToAssign, setTerminalToAssign] = useState<TerminalRecord | null>(
    null
  );
  const hasAdditionalPaneCapacity =
    workspace.panes.some(
      (pane) => pane.id !== selectedPaneId && pane.terminalId === null
    ) ||
    (!!onAddPane && workspace.panes.length < MAX_MONITOR_PANES);

  const createOrSelectAdditionalPane = (): string | undefined => {
    const emptyPane = workspace.panes.find(
      (pane) => pane.id !== selectedPaneId && pane.terminalId === null
    );
    const paneId =
      emptyPane?.id ??
      (workspace.panes.length < MAX_MONITOR_PANES ? onAddPane?.() : undefined);
    if (paneId) onSelectPane?.(paneId);
    return paneId;
  };

  const assignToNewPane = () => {
    if (!terminalToAssign || !hasAdditionalPaneCapacity) return;
    const paneId = createOrSelectAdditionalPane();
    if (!paneId) return;
    onAssignTerminal(paneId, terminalToAssign.id);
    setTerminalToAssign(null);
  };

  const assignToSelectedPane = () => {
    if (!selectedPaneId || !terminalToAssign) return;
    onAssignTerminal(selectedPaneId, terminalToAssign.id);
    setTerminalToAssign(null);
  };

  const handleTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number
  ) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const delta = event.key === "ArrowRight" ? 1 : -1;
    const nextIndex =
      (index + delta + workspace.panes.length) % workspace.panes.length;
    const nextPane = workspace.panes[nextIndex];
    if (!nextPane) return;
    onSelectPane?.(nextPane.id);
    document.getElementById(`monitor-tab-${nextIndex}`)?.focus();
  };

  const createTerminalInMonitor = () => {
    if (!selectedPaneId) return;
    let targetPaneId = selectedPaneId;
    if (selectedPane?.terminalId && hasAdditionalPaneCapacity) {
      const paneId = createOrSelectAdditionalPane();
      if (!paneId) return;
      targetPaneId = paneId;
    }
    void onCreateTerminal?.(targetPaneId);
  };

  const desktopPanes = workspace.panes.some((pane) => pane.terminalId)
    ? workspace.panes.filter((pane) => pane.terminalId)
    : workspace.panes;
  const visiblePanes = mobile ? workspace.panes : desktopPanes;

  return (
    <div
      className={cn(
        "h-full min-w-0 w-full",
        mobile ? "flex flex-col" : "flex"
      )}
    >
      {mobile && (
        <div className="bg-background glass-edge-bottom relative z-10 flex shrink-0 items-center gap-1 px-2 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))]">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open sidebar"
            className="h-11 w-11 shrink-0 rounded-full"
            onClick={onMenuClick}
          >
            <Menu className="h-[1.125rem] w-[1.125rem]" />
          </Button>
          <div
            role="tablist"
            aria-label="Monitor terminals"
            className="flex min-w-0 flex-1 items-center gap-0.5 rounded-full bg-[var(--fill-4)] p-0.5"
          >
            {workspace.panes.map((pane, index) => {
              const terminal = terminals.find(
                (candidate) => candidate.id === pane.terminalId
              );
              const label = terminal?.name ?? `Empty ${index + 1}`;
              const selected = pane.id === selectedPaneId;

              return (
                <button
                  key={pane.id}
                  id={`monitor-tab-${index}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls={`monitor-panel-${index}`}
                  tabIndex={selected ? 0 : -1}
                  title={label}
                  onClick={() => onSelectPane?.(pane.id)}
                  onKeyDown={(event) => handleTabKeyDown(event, index)}
                  className={cn(
                    "press-sm focus-ring flex h-11 min-w-0 flex-1 items-center justify-center rounded-full px-1.5 text-[0.6875rem] font-medium transition-colors",
                    selected
                      ? "bg-[var(--fill-1)] text-foreground shadow-[var(--elev-1)]"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <span className="truncate">{label}</span>
                </button>
              );
            })}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Add to monitor"
                title="Add to monitor"
                className="h-11 w-11 shrink-0 rounded-full"
              >
                <ListPlus className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="bottom" className="w-64">
              <DropdownMenuLabel>Add terminal</DropdownMenuLabel>
              <DropdownMenuItem
                disabled={!selectedPaneId || !onCreateTerminal}
                onSelect={createTerminalInMonitor}
              >
                <TerminalSquare />
                {selectedPane?.terminalId
                  ? hasAdditionalPaneCapacity
                    ? "Create terminal in new tab"
                    : "Replace with new terminal"
                  : "Create terminal in selected tab"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Use existing terminal</DropdownMenuLabel>
              {terminals.length > 0 ? (
                terminals.map((terminal) => (
                  <DropdownMenuItem
                    key={terminal.id}
                    disabled={
                      !selectedPaneId ||
                      workspace.panes.some(
                        (pane) => pane.terminalId === terminal.id
                      )
                    }
                    onSelect={() => {
                      setTerminalToAssign(terminal);
                    }}
                  >
                    <TerminalSquare />
                    <span className="min-w-0 truncate">{terminal.name}</span>
                  </DropdownMenuItem>
                ))
              ) : (
                <DropdownMenuItem disabled>No terminals available</DropdownMenuItem>
              )}
              {workspace.panes.length < MAX_MONITOR_PANES && onAddPane && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => {
                      const paneId = onAddPane();
                      if (paneId) onSelectPane?.(paneId);
                    }}
                  >
                    <Plus />
                    Add empty tab
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Exit monitor view"
            title="Exit monitor view"
            className="h-11 w-11 shrink-0 rounded-full"
            onClick={onToggleMonitor}
          >
            <Columns3 className="h-4 w-4" />
          </Button>
          <Dialog
            open={terminalToAssign !== null}
            onOpenChange={(open) => {
              if (!open) setTerminalToAssign(null);
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add terminal to monitor</DialogTitle>
                <DialogDescription>
                  Choose where to put “{terminalToAssign?.name}”.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setTerminalToAssign(null)}
                >
                  Cancel
                </Button>
                <Button
                  variant="outline"
                  disabled={!selectedPaneId || !terminalToAssign}
                  onClick={assignToSelectedPane}
                >
                  {selectedPane?.terminalId
                    ? "Replace selected tab"
                    : "Use selected tab"}
                </Button>
                {hasAdditionalPaneCapacity && (
                  <Button
                    disabled={!terminalToAssign}
                    onClick={assignToNewPane}
                  >
                    <Plus />
                    Add as new tab
                  </Button>
                )}
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}
      <div
        className={cn(
          "min-h-0 min-w-0 w-full",
          mobile
            ? "flex-1"
            : "grid h-full flex-1 gap-px bg-[var(--fill-2)]"
        )}
        style={
          mobile
            ? undefined
            : {
                gridTemplateColumns: `repeat(${visiblePanes.length}, minmax(0, 1fr))`,
              }
        }
      >
        {visiblePanes.map((pane, index) => {
          const terminal = terminals.find(
            (candidate) => candidate.id === pane.terminalId
          );
          const selected = pane.id === selectedPaneId;

          return (
            <div
              key={pane.id}
              id={`monitor-panel-${index}`}
              role={mobile ? "tabpanel" : undefined}
              aria-labelledby={mobile ? `monitor-tab-${index}` : undefined}
              hidden={mobile && !selected}
              className={cn(
                "min-w-0 w-full",
                mobile ? "h-full" : "min-h-0"
              )}
            >
              <MonitorPane
                paneId={pane.id}
                terminalId={pane.terminalId}
                terminal={terminal}
                projectName={projectNameFor(terminal, projects)}
                canRemove={canRemove}
                canInsert={canInsert}
                mobile={mobile}
                isActive={selected}
                onAssign={onAssignTerminal}
                onMove={onMovePane}
                onRemove={onRemovePane}
                onTerminalsChanged={onTerminalsChanged}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
