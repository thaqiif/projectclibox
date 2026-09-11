"use client";

import { useState, useCallback, useRef } from "react";
import { PaneProvider, usePanes } from "@/contexts/PaneContext";
import { Pane } from "@/components/Pane";
import { useViewport } from "@/hooks/useViewport";
import { useViewportHeight } from "@/hooks/useViewportHeight";
import { useTerminals } from "@/hooks/useTerminals";
import { useProjects } from "@/hooks/useProjects";
import type { TerminalRecord } from "@/lib/terminals";
import { tmuxAttachCommand } from "@/lib/tmux-attach";
import type { TerminalHandle } from "@/components/Terminal";
import { DesktopView } from "@/components/views/DesktopView";
import { MobileView } from "@/components/views/MobileView";

// Debug log buffer - persists even if console is closed
const debugLogs: string[] = [];
const MAX_DEBUG_LOGS = 100;

function debugLog(message: string) {
  const timestamp = new Date().toISOString().split("T")[1].slice(0, 12);
  const entry = `[${timestamp}] ${message}`;
  debugLogs.push(entry);
  if (debugLogs.length > MAX_DEBUG_LOGS) debugLogs.shift();
  console.log(`[CLIWeb] ${message}`);
}

// Expose to window for debugging
if (typeof window !== "undefined") {
  (window as unknown as { cliwebLogs: () => void }).cliwebLogs = () => {
    console.log("=== CLIWeb Debug Logs ===");
    debugLogs.forEach((log) => console.log(log));
    console.log("=== End Logs ===");
  };
}

function HomeContent() {
  // UI State
  const [sidebarOpenState, setSidebarOpenState] = useState<boolean | null>(
    null
  );
  const terminalRef = useRef<TerminalHandle | null>(null);

  // Pane context
  const { attachedTmux, attach, detach } = usePanes();
  const { isMobile, isHydrated } = useViewport();

  // Set CSS variable for viewport height (handles mobile keyboard)
  useViewportHeight();

  // Data hooks
  const { terminals, fetchTerminals, createTerminal, killTerminal } =
    useTerminals();
  const { projects } = useProjects();

  // Terminal ref management. There is exactly one terminal in the
  // workbench now, so this is a single slot rather than a keyed map.
  const registerTerminalRef = useCallback((ref: TerminalHandle | null) => {
    terminalRef.current = ref;
    debugLog(ref ? "Terminal registered" : "Terminal unregistered");
  }, []);

  const getTerminal = useCallback((): TerminalHandle | undefined => {
    if (!terminalRef.current) {
      debugLog("NO TERMINAL AVAILABLE");
      return undefined;
    }
    return terminalRef.current;
  }, []);

  /**
   * Point the workbench at a tmux terminal.
   *
   * The pty behind the terminal is a plain shell, so "attaching" means
   * running `tmux attach` in it. If it is already inside tmux we detach
   * first (Ctrl-B d) and clear whatever is on the command line, otherwise
   * the attach command would be typed into the running program instead of
   * the shell.
   */
  const attachToTerminal = useCallback(
    (name: string) => {
      const record = terminals.find((t) => t.tmux_name === name);
      const command = tmuxAttachCommand(name, record?.working_directory);

      const terminal = getTerminal();

      // Already looking at it. Re-running the attach would detach the
      // client and immediately reattach, which throws away the redraw and
      // leaves whatever tmux was drawing half on screen. A stopped terminal
      // is the exception: clicking it is a request to start it again.
      if (terminal && attachedTmux === name && record?.alive !== false) {
        terminal.focus();
        return;
      }

      // Nothing is mounted while the welcome screen is up. Recording the
      // attachment is enough: that mounts the terminal, and its connect
      // handler runs the same command once the pty is ready.
      if (!terminal) {
        debugLog(`Attaching on mount: ${name}`);
        attach(name);
        void fetchTerminals();
        return;
      }

      const isInTmux = !!attachedTmux;
      if (isInTmux) terminal.sendInput("\x02d");

      setTimeout(
        () => {
          terminal.sendInput("\x03");
          setTimeout(() => {
            terminal.sendCommand(command);
            attach(name);
            terminal.focus();
            // The restart changes what the listing should say.
            void fetchTerminals();
          }, 50);
        },
        isInTmux ? 100 : 0
      );
    },
    [getTerminal, attachedTmux, attach, terminals, fetchTerminals]
  );

  /**
   * Stop looking at a terminal without killing it.
   *
   * Detaching leaves the tmux terminal and everything running in it exactly
   * where it was; the workbench just stops pointing at it and falls back to
   * the welcome screen. Unmounting the terminal drops the pty, which tmux
   * sees as a detached client, so the Ctrl-B d is belt and braces.
   */
  const handleDetachTerminal = useCallback(() => {
    getTerminal()?.sendInput("\x02d");
    detach();
  }, [getTerminal, detach]);

  // The attached tmux terminal is what the workbench is looking at.
  const activeTerminal = terminals.find((t) => t.tmux_name === attachedTmux);

  // Keep the desktop sidebar open by default without synchronizing derived
  // viewport state through an effect. Once the user explicitly changes it,
  // that choice wins on both viewport sizes.
  const sidebarOpen = sidebarOpenState ?? (isHydrated && !isMobile);

  const handleSelectTerminal = useCallback(
    (name: string) => {
      debugLog(`handleSelectTerminal: ${name}`);
      attachToTerminal(name);
    },
    [attachToTerminal]
  );

  /**
   * Open a new terminal.
   *
   * It is a plain shell in a working directory. Any additional CLI is started
   * manually by typing its name, and tmux keeps the terminal's process and
   * layout alive.
   */
  const handleNewTerminal = useCallback(
    async (projectId?: string) => {
      const project = projectId
        ? projects.find((p) => p.id === projectId)
        : undefined;

      const terminal = await createTerminal({
        cwd: project?.working_directory,
        projectId,
      });

      await fetchTerminals();
      setTimeout(() => attachToTerminal(terminal.name), 100);
    },
    [projects, createTerminal, fetchTerminals, attachToTerminal]
  );

  const handleCloseTerminal = useCallback(
    async (name: string) => {
      await killTerminal(name);
      if (attachedTmux === name) detach();
      await fetchTerminals();
    },
    [killTerminal, attachedTmux, detach, fetchTerminals]
  );

  // Pane renderer. Declared after the handlers it hands to the welcome
  // screen, since the dependency array reads them at render time.
  const renderPane = useCallback(
    () => (
      <Pane
        terminals={terminals}
        projects={projects}
        onRegisterTerminal={registerTerminalRef}
        onMenuClick={isMobile ? () => setSidebarOpenState(true) : undefined}
        onSelectTerminal={handleSelectTerminal}
        onNewTerminal={() => void handleNewTerminal()}
      />
    ),
    [
      terminals,
      projects,
      registerTerminalRef,
      isMobile,
      handleSelectTerminal,
      handleNewTerminal,
    ]
  );

  // View props
  const viewProps = {
    terminals,
    projects,
    sidebarOpen,
    setSidebarOpen: setSidebarOpenState,
    activeTerminal: activeTerminal as TerminalRecord | undefined,
    attachToTerminal,
    handleNewTerminal,
    handleCloseTerminal,
    fetchTerminals,
    handleDetachTerminal,
    renderPane,
  };

  if (isMobile) {
    return <MobileView {...viewProps} />;
  }

  return <DesktopView {...viewProps} />;
}

export default function Home() {
  return (
    <PaneProvider>
      <HomeContent />
    </PaneProvider>
  );
}
