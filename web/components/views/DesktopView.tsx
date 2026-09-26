"use client";

import { DesktopSidebar } from "./DesktopSidebar";
import { Button } from "@/components/ui/button";
import { PanelLeftClose, PanelLeftOpen, Plus } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ViewProps } from "./types";
import { useSidebarPinned } from "@/hooks/useSidebarPinned";
import { MonitorWorkspace } from "@/components/MonitorWorkspace";
import { MAX_MONITOR_PANES } from "@/lib/monitor-workspace";

export function DesktopView({
  terminals,
  projects,
  handleNewTerminal,
  handleCloseTerminal,
  fetchTerminals,
  monitor,
}: ViewProps) {
  const { isPinned, togglePin } = useSidebarPinned();
  return (
    <div className="ambient-canvas flex h-screen overflow-hidden">
      <DesktopSidebar
        isPinned={isPinned}
        onSelect={monitor.openTerminal}
        onNewTerminal={handleNewTerminal}
        onCloseTerminal={handleCloseTerminal}
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
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {monitor.workspace &&
              !monitor.workspace.panes.some((pane) => pane.terminalId) && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Add monitor pane"
                  disabled={monitor.workspace.panes.length >= MAX_MONITOR_PANES}
                  onClick={monitor.addPane}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              )}
          </div>
        </header>

        {/* Keep the terminal surface independent of the shell chrome. */}
        <div className="bg-background relative min-h-0 w-full min-w-0 flex-1">
          {monitor.workspace && (
            <MonitorWorkspace
              workspace={monitor.workspace}
              terminals={terminals}
              projects={projects}
              onAssignTerminal={monitor.assignTerminal}
              onMovePane={monitor.movePane}
              onRemovePane={monitor.removePane}
              onTerminalsChanged={fetchTerminals}
            />
          )}
        </div>
      </div>
    </div>
  );
}
