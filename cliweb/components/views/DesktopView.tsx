"use client";

import { DesktopSidebar } from "./DesktopSidebar";
import { Button } from "@/components/ui/button";
import {
  Columns3,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  X,
} from "lucide-react";
import { WorkbenchBar } from "./WorkbenchBar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ViewProps } from "./types";
import { useSidebarPinned } from "@/hooks/useSidebarPinned";
import { useTerminalRename } from "@/hooks/useTerminalRename";
import { WorkbenchTitle } from "./WorkbenchTitle";
import { MonitorWorkspace } from "@/components/MonitorWorkspace";

export function DesktopView({
  terminals,
  projects,
  activeTerminal,
  attachToTerminal,
  handleNewTerminal,
  handleCloseTerminal,
  fetchTerminals,
  handleDetachTerminal,
  renderPane,
  monitor,
}: ViewProps) {
  const { isPinned, togglePin } = useSidebarPinned();
  const renameTerminal = useTerminalRename();
  return (
    <div className="ambient-canvas flex h-screen overflow-hidden">
      <DesktopSidebar
        isPinned={isPinned}
        activeTerminalId={activeTerminal?.id}
        onSelect={(id) => attachToTerminal(id)}
        onNewTerminal={handleNewTerminal}
        onCloseTerminal={handleCloseTerminal}
        onClosedAllTerminals={handleDetachTerminal}
      />

      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* The compact command strip shares the sidebar surface and a hairline
            edge. The terminal remains the dominant content surface. */}
        <header className="glass glass-edge-bottom relative z-10 flex h-11 shrink-0 items-center justify-between gap-3 px-3">
          <div className="flex min-w-0 items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Toggle sidebar"
                  aria-pressed={isPinned}
                  className="h-7 w-7 rounded-sm"
                  onClick={togglePin}
                >
                  {isPinned ? (
                    <PanelLeftClose className="h-4 w-4" />
                  ) : (
                    <PanelLeftOpen className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Toggle sidebar</p>
              </TooltipContent>
            </Tooltip>

            {activeTerminal && !monitor.workspace?.enabled && (
              <div className="ml-2 flex min-w-0 items-center gap-1 border-l border-[var(--shell-line)] pl-3">
                <WorkbenchTitle
                  name={activeTerminal.name}
                  onRename={renameTerminal}
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Close terminal"
                      className="h-6 w-6 shrink-0 rounded-sm"
                      onClick={() => void handleCloseTerminal(activeTerminal.name)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Close terminal</p>
                    <p className="text-muted-foreground text-[0.6875rem]">
                      Kills anything running in it
                    </p>
                  </TooltipContent>
                </Tooltip>
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {monitor.workspace?.enabled &&
              !monitor.workspace.panes.some((pane) => pane.terminalId) && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Add monitor pane"
                  disabled={monitor.workspace.panes.length >= 3}
                  onClick={monitor.addPane}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              )}
            <Button
              variant={monitor.workspace?.enabled ? "secondary" : "ghost"}
              size="sm"
              aria-label="Toggle monitor workspace"
              aria-pressed={monitor.workspace?.enabled ?? false}
              disabled={!monitor.workspace}
              onClick={monitor.toggle}
            >
              <Columns3 className="h-4 w-4" /> Monitor
            </Button>
            {!monitor.workspace?.enabled && <WorkbenchBar />}
          </div>
        </header>

        {/* Keep the terminal surface independent of the shell chrome. */}
        <div className="bg-background relative min-h-0 min-w-0 w-full flex-1">
          {monitor.workspace?.enabled ? (
            <MonitorWorkspace
              workspace={monitor.workspace}
              terminals={terminals}
              projects={projects}
              onAssignTerminal={monitor.assignTerminal}
              onMovePane={monitor.movePane}
              onRemovePane={monitor.removePane}
              onTerminalsChanged={fetchTerminals}
            />
          ) : (
            renderPane()
          )}
        </div>
      </div>
    </div>
  );
}
