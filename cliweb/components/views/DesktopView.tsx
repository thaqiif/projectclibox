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
import { QuickSwitcher } from "@/components/QuickSwitcher";
import type { ViewProps } from "./types";
import { fileOpenActions } from "@/stores/fileOpen";
import { useSidebarPinned } from "@/hooks/useSidebarPinned";
import { useTerminalRename } from "@/hooks/useTerminalRename";
import { WorkbenchTitle } from "./WorkbenchTitle";
import { MonitorWorkspace } from "@/components/MonitorWorkspace";
import { useMonitorWorkspace } from "@/hooks/useMonitorWorkspace";

export function DesktopView({
  terminals,
  projects,
  activeTerminal,
  showQuickSwitcher,
  setShowQuickSwitcher,
  attachToTerminal,
  handleNewTerminal,
  handleCloseTerminal,
  fetchTerminals,
  handleCreateProject,
  renderPane,
}: ViewProps) {
  const { isPinned, togglePin } = useSidebarPinned();
  const renameTerminal = useTerminalRename();
  const monitor = useMonitorWorkspace();

  return (
    <div className="ambient-canvas flex h-screen overflow-hidden">
      <DesktopSidebar
        isPinned={isPinned}
        activeTerminalId={activeTerminal?.id}
        onSelect={(id) => attachToTerminal(id)}
        onNewTerminal={handleNewTerminal}
        onCloseTerminal={handleCloseTerminal}
        onQuickSwitch={() => setShowQuickSwitcher(true)}
      />

      {/* Main content */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Command strip. The left is identity — sidebar toggle and what is
            attached — and the view controls own the right. It is glass, and
            it is edge-lit rather than underlined: content dissolves beneath
            the bar instead of stopping at a rule. */}
        <header className="glass glass-edge-bottom relative z-10 flex h-13 shrink-0 items-center justify-between gap-3 px-3">
          <div className="flex min-w-0 items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Toggle sidebar"
                  aria-pressed={isPinned}
                  className="h-8 w-8 rounded-full"
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
              <div className="ml-1 flex min-w-0 items-center gap-1 rounded-full bg-[var(--fill-4)] py-1 pr-1 pl-3">
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
                      className="h-6 w-6 shrink-0 rounded-full"
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
            {monitor.workspace?.enabled && (
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

        {/* The terminal is content, not chrome: it stays opaque, and the
            glass bar above it is what floats. */}
        <div className="bg-background relative min-h-0 flex-1">
          {monitor.workspace?.enabled ? (
            <MonitorWorkspace
              workspace={monitor.workspace}
              terminals={terminals}
              projects={projects}
              onAssignTerminal={monitor.assignTerminal}
              onRemovePane={monitor.removePane}
              onResize={monitor.resize}
              onTerminalsChanged={fetchTerminals}
            />
          ) : (
            renderPane()
          )}
        </div>
      </div>

      {/* Dialogs */}
      <QuickSwitcher
        terminals={terminals}
        open={showQuickSwitcher}
        onOpenChange={setShowQuickSwitcher}
        currentTerminalId={activeTerminal?.id}
        activeTerminalWorkingDir={
          activeTerminal?.working_directory ?? undefined
        }
        onSelectTerminal={attachToTerminal}
        onSelectFile={(file, line) => {
          // Resolve a relative path against the terminal's working directory.
          const absolutePath = activeTerminal?.working_directory
            ? `${activeTerminal.working_directory}/${file.replace(/^\.\//, "")}`
            : file;
          fileOpenActions.requestOpen(absolutePath, line);
        }}
      />
    </div>
  );
}
