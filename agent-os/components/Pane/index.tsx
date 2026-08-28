"use client";

import { useRef, useCallback, useEffect, memo, useMemo } from "react";
import dynamic from "next/dynamic";
import { usePanes } from "@/contexts/PaneContext";
import { useViewport } from "@/hooks/useViewport";
import type { TerminalHandle } from "@/components/Terminal";
import type { ProjectWithRepositories } from "@/lib/projects";
import type { TerminalRecord } from "@/lib/terminals";
import { terminalStateRegistry } from "@/lib/client/terminal-state-registry";
import { cn } from "@/lib/utils";
import { useFileEditor } from "@/hooks/useFileEditor";
import { MobileTabBar } from "./MobileTabBar";
import {
  TerminalSkeleton,
  FileExplorerSkeleton,
  GitPanelSkeleton,
} from "./PaneSkeletons";
import {
  Panel as ResizablePanel,
  Group as ResizablePanelGroup,
  Separator as ResizablePanelHandle,
} from "react-resizable-panels";
import { GitDrawer } from "@/components/GitDrawer";
import { ShellDrawer } from "@/components/ShellDrawer";
import { useSnapshot } from "valtio";
import { fileOpenStore, fileOpenActions } from "@/stores/fileOpen";
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

const GitPanel = dynamic(
  () => import("@/components/GitPanel").then((mod) => mod.GitPanel),
  { ssr: false, loading: () => <GitPanelSkeleton /> }
);

interface PaneProps {
  terminals: TerminalRecord[];
  projects: ProjectWithRepositories[];
  onRegisterTerminal: (ref: TerminalHandle | null) => void;
  onMenuClick?: () => void;
  onSelectTerminal?: (name: string) => void;
  /** Welcome-screen actions, used only while nothing is attached. */
  onNewTerminal?: () => void;
  onQuickSwitch?: () => void;
}

/**
 * The workbench's single terminal, plus the file and git views that share
 * its working directory.
 *
 * There is one terminal and one tmux attachment. Splitting is delegated to
 * tmux (see /api/tmux/split), so what used to be a tree of React panes with
 * a tab strip on each is now a single surface showing whatever tmux draws.
 */
export const Pane = memo(function Pane({
  terminals,
  projects,
  onRegisterTerminal,
  onMenuClick,
  onSelectTerminal,
  onNewTerminal,
  onQuickSwitch,
}: PaneProps) {
  const { isMobile } = useViewport();
  const {
    paneId,
    attachedTmux,
    viewMode,
    gitDrawerOpen,
    shellDrawerOpen,
    setViewMode,
    toggleGitDrawer,
    toggleShellDrawer,
  } = usePanes();

  const terminalRef = useRef<TerminalHandle | null>(null);

  // The attached tmux terminal is the source of truth for which working
  // directory the Files and Git views point at.
  const currentTerminal = useMemo(
    () => terminals.find((t) => t.tmux_name === attachedTmux) ?? null,
    [terminals, attachedTmux]
  );

  const fileEditor = useFileEditor();

  const currentProject = useMemo(() => {
    if (!currentTerminal?.project_id) return null;
    return projects.find((p) => p.id === currentTerminal.project_id) || null;
  }, [currentTerminal, projects]);

  const projectRepositories = useMemo(() => {
    if (!currentProject) return [];
    return currentProject.repositories;
  }, [currentProject]);

  const { request: fileOpenRequest } = useSnapshot(fileOpenStore);

  // Reset to the terminal when the attachment changes.
  useEffect(() => {
    setViewMode("terminal");
    fileEditor.reset();
  }, [attachedTmux]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (fileOpenRequest && currentTerminal) {
      setViewMode("files");
      fileEditor.openFile(fileOpenRequest.path);
      fileOpenActions.clearRequest();
    }
  }, [fileOpenRequest, currentTerminal, fileEditor, setViewMode]);

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

  // Swipe between terminals on mobile.
  const touchStartX = useRef<number | null>(null);
  const currentIndex = currentTerminal
    ? terminals.findIndex((t) => t.id === currentTerminal.id)
    : -1;
  const SWIPE_THRESHOLD = 120;

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (viewMode !== "terminal") return;
      touchStartX.current = e.touches[0].clientX;
    },
    [viewMode]
  );

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (viewMode !== "terminal" || touchStartX.current === null) return;

      const diff = e.changedTouches[0].clientX - touchStartX.current;
      touchStartX.current = null;

      if (Math.abs(diff) <= SWIPE_THRESHOLD) return;

      const nextIndex = diff > 0 ? currentIndex - 1 : currentIndex + 1;
      if (nextIndex >= 0 && nextIndex < terminals.length) {
        onSelectTerminal?.(terminals[nextIndex].id);
      }
    },
    [viewMode, currentIndex, terminals, onSelectTerminal]
  );

  const savedState = terminalStateRegistry.getTerminalState(paneId, "terminal");

  const terminal = (
    <Terminal
      ref={setTerminalRef}
      onConnected={handleTerminalConnected}
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
      onQuickSwitch={onQuickSwitch}
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
        />
      )}

      {isMobile ? (
        <div
          className="relative min-h-0 w-full flex-1"
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
        >
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

          {currentTerminal?.working_directory && (
            <div className={viewMode === "git" ? "h-full" : "hidden"}>
              <GitPanel
                workingDirectory={currentTerminal.working_directory}
                projectId={currentProject?.id}
                repositories={projectRepositories}
              />
            </div>
          )}
        </div>
      ) : (
        <ResizablePanelGroup
          orientation="horizontal"
          className="min-h-0 flex-1"
        >
          {/* Left column: main content + shell drawer */}
          <ResizablePanel defaultSize={gitDrawerOpen ? 70 : 100} minSize={20}>
            <ResizablePanelGroup orientation="vertical" className="h-full">
              <ResizablePanel
                defaultSize={shellDrawerOpen ? 70 : 100}
                minSize={10}
              >
                <div className="relative h-full">
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
              </ResizablePanel>

              {shellDrawerOpen && currentTerminal?.working_directory && (
                <>
                  <ResizablePanelHandle className="relative h-px cursor-row-resize bg-[var(--fill-2)] transition-colors duration-200 after:absolute after:inset-x-0 after:-top-1 after:h-3 after:content-[''] hover:bg-primary/40 active:bg-primary/60" />
                  <ResizablePanel defaultSize={30} minSize={10}>
                    <ShellDrawer
                      open={true}
                      onOpenChange={toggleShellDrawer}
                      workingDirectory={currentTerminal.working_directory}
                    />
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          </ResizablePanel>

          {gitDrawerOpen && currentTerminal?.working_directory && (
            <>
              <ResizablePanelHandle className="relative w-px cursor-col-resize bg-[var(--fill-2)] transition-colors duration-200 after:absolute after:inset-y-0 after:-left-1 after:w-3 after:content-[''] hover:bg-primary/40 active:bg-primary/60" />
              <ResizablePanel defaultSize={30} minSize={10}>
                <GitDrawer
                  open={true}
                  onOpenChange={toggleGitDrawer}
                  workingDirectory={currentTerminal.working_directory}
                  projectId={currentProject?.id}
                  repositories={projectRepositories}
                />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      )}
    </div>
  );
});
