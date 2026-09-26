"use client";

import { useState } from "react";
import { TerminalList } from "@/components/TerminalList";
import { MobileSidebar } from "@/components/mobile/MobileSidebar";
import { MonitorWorkspace } from "@/components/MonitorWorkspace";
import { MAX_MONITOR_PANES } from "@/lib/monitor-workspace";
import type { ViewProps } from "./types";

export function MobileView({
  sidebarOpen,
  setSidebarOpen,
  handleNewTerminal,
  handleCloseTerminal,
  terminals,
  projects,
  fetchTerminals,
  monitor,
}: ViewProps) {
  const [selectedPaneId, setSelectedPaneId] = useState<string | null>(null);
  const selectedPane =
    monitor.workspace?.panes.find((pane) => pane.id === selectedPaneId) ??
    monitor.workspace?.panes[0];

  return (
    <main className="bg-background h-app flex flex-col overflow-hidden">
      {/* Sidebar */}
      <MobileSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)}>
        <div className="flex h-full flex-col">
          {/* Terminal list */}
          <div className="min-h-0 flex-1 overflow-hidden">
            <TerminalList
              activeTerminalId={selectedPane?.terminalId ?? undefined}
              onSelect={(id) => {
                if (selectedPane) monitor.assignTerminal(selectedPane.id, id);
                setSidebarOpen(false);
              }}
              onNewTerminal={async (projectId) => {
                let targetPaneId = selectedPane?.id;
                if (
                  selectedPane?.terminalId &&
                  (monitor.workspace?.panes.length ?? MAX_MONITOR_PANES) <
                    MAX_MONITOR_PANES
                ) {
                  targetPaneId = monitor.addPane() ?? targetPaneId;
                  if (targetPaneId) setSelectedPaneId(targetPaneId);
                }
                await handleNewTerminal(projectId, targetPaneId);
                setSidebarOpen(false);
              }}
              onCloseTerminal={handleCloseTerminal}
              onCloseSidebar={() => setSidebarOpen(false)}
            />
          </div>
        </div>
      </MobileSidebar>

      {/* One monitor terminal fills the screen at mobile widths. */}
      <div className="min-h-0 w-full flex-1">
        {monitor.workspace && (
          <MonitorWorkspace
            workspace={monitor.workspace}
            terminals={terminals}
            projects={projects}
            onAssignTerminal={monitor.assignTerminal}
            onMovePane={monitor.movePane}
            onRemovePane={monitor.removePane}
            onTerminalsChanged={fetchTerminals}
            mobile
            activePaneId={selectedPane?.id}
            onSelectPane={setSelectedPaneId}
            onAddPane={monitor.addPane}
            onCreateTerminal={(paneId) => handleNewTerminal(undefined, paneId)}
            onMenuClick={() => setSidebarOpen(true)}
          />
        )}
      </div>
    </main>
  );
}
