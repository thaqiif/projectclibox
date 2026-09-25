"use client";

import { useState } from "react";
import { TerminalList } from "@/components/TerminalList";
import { MobileSidebar } from "@/components/mobile/MobileSidebar";
import { MonitorWorkspace } from "@/components/MonitorWorkspace";
import type { ViewProps } from "./types";

export function MobileView({
  sidebarOpen,
  setSidebarOpen,
  activeTerminal,
  attachToTerminal,
  handleNewTerminal,
  handleCloseTerminal,
  renderPane,
  terminals,
  projects,
  fetchTerminals,
  monitor,
}: ViewProps) {
  const [selectedPaneId, setSelectedPaneId] = useState<string | null>(null);
  const selectedPane =
    monitor.workspace?.panes.find((pane) => pane.id === selectedPaneId) ??
    monitor.workspace?.panes[0];
  const monitorEnabled = monitor.workspace?.enabled ?? false;

  return (
    <main className="bg-background h-app flex flex-col overflow-hidden">
      {/* Sidebar */}
      <MobileSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)}>
        <div className="flex h-full flex-col">
          {/* Terminal list */}
          <div className="min-h-0 flex-1 overflow-hidden">
            <TerminalList
              activeTerminalId={
                monitorEnabled
                  ? (selectedPane?.terminalId ?? undefined)
                  : activeTerminal?.id
              }
              onSelect={(id) => {
                if (monitorEnabled && selectedPane) {
                  monitor.assignTerminal(selectedPane.id, id);
                } else {
                  attachToTerminal(id);
                }
                setSidebarOpen(false);
              }}
              onNewTerminal={async (projectId) => {
                let targetPaneId = selectedPane?.id;
                if (
                  monitorEnabled &&
                  selectedPane?.terminalId &&
                  (monitor.workspace?.panes.length ?? 3) < 3
                ) {
                  targetPaneId = monitor.addPane() ?? targetPaneId;
                  if (targetPaneId) setSelectedPaneId(targetPaneId);
                }
                await handleNewTerminal(
                  projectId,
                  monitorEnabled ? targetPaneId : undefined
                );
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
        {monitorEnabled && monitor.workspace ? (
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
            onToggleMonitor={monitor.toggle}
            onMenuClick={() => setSidebarOpen(true)}
          />
        ) : (
          renderPane()
        )}
      </div>
    </main>
  );
}
