"use client";

import { useRef, useCallback, useEffect, memo, useMemo } from "react";
import dynamic from "next/dynamic";
import { usePanes } from "@/contexts/PaneContext";
import { useViewport } from "@/hooks/useViewport";
import type { TerminalHandle } from "@/components/Terminal";
import type { Project } from "@/lib/db";
import type { TerminalRecord } from "@/lib/terminals";
import { terminalStateRegistry } from "@/lib/client/terminal-state-registry";
import { cn } from "@/lib/utils";
import { useFileEditor } from "@/hooks/useFileEditor";
import { MobileTabBar } from "./MobileTabBar";
import {
  TerminalSkeleton,
  FileExplorerSkeleton,
} from "./PaneSkeletons";
import { Welcome } from "@/components/Welcome";
import { tmuxAttachCommand } from "@/lib/tmux-attach";

// Dynamic imports for client-only components with loading states
const Terminal = dynamic(
  () => import("@/components/Terminal").then((mod) => mod.Terminal),
  { ssr: false, loading: () => <TerminalSkeleton /> }
);

const FileExplorer = dynamic(
  () => import("@/components/FileExplorer").then((mod) => mod.FileExplorer),
  { ssr: false, loading: () => <FileExplorerSkeleton /> }
);

interface PaneProps {
  terminals: TerminalRecord[];
  projects: Project[];
  onRegisterTerminal: (ref: TerminalHandle | null) => void;
  onMenuClick?: () => void;
  onSelectTerminal?: (name: string) => void;
  /** Welcome-screen actions, used only while nothing is attached. */
  onNewTerminal?: () => void;
  onMonitorToggle?: () => void;
  monitorAvailable?: boolean;
}

/**
 * The workbench's single terminal and file view that share its working
 * directory.
 *
 * There is one terminal and one tmux attachment. What used to be a tree of
 * React panes with a tab strip on each is now a single surface showing
 * whatever tmux draws.
 */
export const Pane = memo(function Pane({
  terminals,
  projects,
  onRegisterTerminal,
  onMenuClick,
  onSelectTerminal,
  onNewTerminal,
  onMonitorToggle,
  monitorAvailable = false,
}: PaneProps) {
  const { isMobile } = useViewport();
  const { paneId, attachedTmux, viewMode, setViewMode } = usePanes();

  const terminalRef = useRef<TerminalHandle | null>(null);

  // The attached tmux terminal is the source of truth for which working
  // directory the Files view points at.
  const currentTerminal = useMemo(
    () => terminals.find((t) => t.tmux_name === attachedTmux) ?? null,
    [terminals, attachedTmux]
  );

  const fileEditor = useFileEditor();

  // Reset to the terminal when the attachment changes.
  useEffect(() => {
    setViewMode("terminal");
    fileEditor.reset();
  }, [attachedTmux]); // eslint-disable-line react-hooks/exhaustive-deps

  const setTerminalRef = useCallback((handle: TerminalHandle | null) => {
    terminalRef.current = handle;
  }, []);

  // Attach on connect. The pty is a plain shell, so attaching is literally
  // running `tmux attach` in it; tmux then owns everything the user sees,
  // including any panes it was split into earlier.
  const handleTerminalConnected = useCallback(() => {
    const handle = terminalRef.current;
    if (!handle) return;

    onRegisterTerminal(handle);

    if (attachedTmux) {
      const cwd = terminals.find(
        (t) => t.tmux_name === attachedTmux
      )?.working_directory;
      setTimeout(() => {
        handle.sendCommand(tmuxAttachCommand(attachedTmux, cwd));
        handle.focus();
      }, 100);
    }
  }, [attachedTmux, terminals, onRegisterTerminal]);

  useEffect(() => {
    return () => onRegisterTerminal(null);
  }, [onRegisterTerminal]);

  // Detaching unmounts the terminal, so the handle the rest of the app is
  // holding is stale. Drop it, or the next attach would type into nothing.
  useEffect(() => {
    if (!attachedTmux) onRegisterTerminal(null);
  }, [attachedTmux, onRegisterTerminal]);

  const savedState = terminalStateRegistry.getTerminalState(paneId, "terminal");

  const terminal = (
    <Terminal
      ref={setTerminalRef}
      onConnected={handleTerminalConnected}
      workingDirectory={currentTerminal?.working_directory}
      onBeforeUnmount={(scrollState) => {
        terminalStateRegistry.saveTerminalState(paneId, "terminal", {
          scrollTop: scrollState.scrollTop,
          scrollHeight: 0,
          lastActivity: Date.now(),
          cursorY: scrollState.cursorY,
        });
      }}
      initialScrollState={
        savedState
          ? {
              scrollTop: savedState.scrollTop,
              cursorY: savedState.cursorY,
              baseY: 0,
            }
          : undefined
      }
    />
  );

  // Nothing attached means nothing to show: the terminal only exists as a
  // window onto a tmux terminal, so without one it would be a throwaway
  // shell pretending to be persistent.
  const surface = attachedTmux ? (
    terminal
  ) : (
    <Welcome
      terminals={terminals}
      onNewTerminal={() => onNewTerminal?.()}
      onSelectTerminal={(name) => onSelectTerminal?.(name)}
    />
  );

  return (
    <div
      className={cn(
        "flex h-full w-full flex-col overflow-hidden",
        !isMobile && "bg-background"
      )}
    >
      {/* Mobile keeps a header of its own; on desktop the mode switcher
          lives in the workbench top bar, so the pane has no chrome. */}
      {isMobile && (
        <MobileTabBar
          terminal={currentTerminal}
          projects={projects}
          viewMode={viewMode}
          onMenuClick={onMenuClick}
          onViewModeChange={setViewMode}
          onMonitorToggle={onMonitorToggle}
          monitorAvailable={monitorAvailable}
        />
      )}

      {isMobile ? (
        <div className="relative min-h-0 w-full flex-1">
          <div className={viewMode === "terminal" ? "h-full w-full" : "hidden"}>
            {surface}
          </div>

          {currentTerminal?.working_directory && (
            <div className={viewMode === "files" ? "h-full" : "hidden"}>
              <FileExplorer
                workingDirectory={currentTerminal.working_directory}
                fileEditor={fileEditor}
              />
            </div>
          )}
        </div>
      ) : (
        <div className="relative h-full min-h-0 flex-1">
          <div className={viewMode === "terminal" ? "h-full" : "hidden"}>
            {surface}
          </div>

          {currentTerminal?.working_directory && (
            <div className={viewMode === "files" ? "h-full" : "hidden"}>
              <FileExplorer
                workingDirectory={currentTerminal.working_directory}
                fileEditor={fileEditor}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
});
