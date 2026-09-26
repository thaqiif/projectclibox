"use client";

import { useState, useCallback } from "react";
import { MonitorProvider, useMonitor } from "@/contexts/MonitorContext";
import { useViewport } from "@/hooks/useViewport";
import { useViewportHeight } from "@/hooks/useViewportHeight";
import { useTerminals } from "@/hooks/useTerminals";
import { useProjects } from "@/hooks/useProjects";
import { DesktopView } from "@/components/views/DesktopView";
import { MobileView } from "@/components/views/MobileView";

function HomeContent() {
  // UI State
  const [sidebarOpenState, setSidebarOpenState] = useState<boolean | null>(
    null
  );

  const { isMobile, isHydrated } = useViewport();
  const monitor = useMonitor();
  const { assignTerminal, openTerminal } = monitor;

  // Set CSS variable for viewport height (handles mobile keyboard)
  useViewportHeight();

  // Data hooks
  const { terminals, fetchTerminals, createTerminal, killTerminal } =
    useTerminals();
  const { projects } = useProjects();

  // Keep the desktop sidebar open by default without synchronizing derived
  // viewport state through an effect. Once the user explicitly changes it,
  // that choice wins on both viewport sizes.
  const sidebarOpen = sidebarOpenState ?? (isHydrated && !isMobile);

  /**
   * Open a new terminal and show it in the monitor.
   *
   * It is a plain shell in a working directory. Any additional CLI is started
   * manually by typing its name, and tmux keeps the terminal's process and
   * layout alive. With a pane given it lands there; otherwise it takes the
   * first free pane, or opens beside the others.
   */
  const handleNewTerminal = useCallback(
    async (projectId?: string, monitorPaneId?: string) => {
      const project = projectId
        ? projects.find((p) => p.id === projectId)
        : undefined;

      const terminal = await createTerminal({
        cwd: project?.working_directory,
        projectId,
      });

      await fetchTerminals();
      if (monitorPaneId) {
        assignTerminal(monitorPaneId, terminal.name);
      } else {
        openTerminal(terminal.name);
      }
    },
    [projects, createTerminal, fetchTerminals, assignTerminal, openTerminal]
  );

  const handleCloseTerminal = useCallback(
    async (name: string) => {
      await killTerminal(name);
      await fetchTerminals();
    },
    [killTerminal, fetchTerminals]
  );

  const viewProps = {
    terminals,
    projects,
    sidebarOpen,
    setSidebarOpen: setSidebarOpenState,
    monitor,
    handleNewTerminal,
    handleCloseTerminal,
    fetchTerminals,
  };

  if (isMobile) {
    return <MobileView {...viewProps} />;
  }

  return <DesktopView {...viewProps} />;
}

export default function Home() {
  return (
    <MonitorProvider>
      <HomeContent />
    </MonitorProvider>
  );
}
