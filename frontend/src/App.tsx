"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { PaneProvider, usePanes } from "@/contexts/PaneContext";
import { Pane } from "@/components/Pane";
import { useViewport } from "@/hooks/useViewport";
import { useViewportHeight } from "@/hooks/useViewportHeight";
import { useTerminals } from "@/hooks/useTerminals";
import { useProjects } from "@/hooks/useProjects";
import {
  api,
  AUTH_REQUIRED_EVENT,
  AUTH_RESTORED_EVENT,
} from "@/api";
import type { TerminalHandle } from "@/components/Terminal";
import { DesktopView } from "@/components/views/DesktopView";
import { MobileView } from "@/components/views/MobileView";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

function HomeContent() {
  const [sidebarOpenState, setSidebarOpenState] = useState<boolean | null>(
    null
  );
  const terminalRef = useRef<TerminalHandle | null>(null);
  const { attachedSessionId, attach, detach } = usePanes();
  const { isMobile, isHydrated } = useViewport();
  useViewportHeight();

  const { terminals, fetchTerminals, createTerminal, killTerminal } =
    useTerminals();
  const { projects, fetchProjects } = useProjects();
  const [authRequired, setAuthRequired] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    const onAuthRequired = () => {
      setAuthRequired(true);
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
  }, []);

  const authenticate = async (token: string) => {
    try {
      await api.authenticate(token);
      setAuthRequired(false);
      setAuthError(null);
      await Promise.all([fetchProjects(), fetchTerminals()]);
      window.dispatchEvent(new Event(AUTH_RESTORED_EVENT));
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Token rejected");
      throw error;
    }
  };

  const registerTerminalRef = useCallback((ref: TerminalHandle | null) => {
    terminalRef.current = ref;
  }, []);

  const attachToTerminal = useCallback(
    (sessionId: string) => {
      const record = terminals.find((terminal) => terminal.id === sessionId);
      if (!record) return;

      const handle = terminalRef.current;
      if (handle && attachedSessionId === sessionId && record.alive) {
        handle.focus();
        return;
      }

      if (!record.alive) {
        void api
          .restart(sessionId)
          .then((replacement) => {
            attach(replacement.id);
            void fetchTerminals();
          })
          .catch((error: unknown) => {
            toast.error(
              error instanceof Error ? error.message : "Unable to restart terminal"
            );
          });
        return;
      }

      // The session id is the complete attachment contract. Changing it
      // remounts the terminal hook, which opens a new direct PTY viewer.
      attach(sessionId);
      void fetchTerminals();
    },
    [attachedSessionId, attach, fetchTerminals, terminals]
  );

  const handleDetachTerminal = useCallback(() => {
    // Unmounting the viewer sends terminal.detach; the PTY session remains
    // alive on the server for the next attachment.
    detach();
  }, [detach]);

  const activeTerminal = terminals.find(
    (terminal) => terminal.id === attachedSessionId
  );
  const sidebarOpen = sidebarOpenState ?? (isHydrated && !isMobile);

  const handleNewTerminal = useCallback(
    async (projectId?: string) => {
      try {
        const project = projectId
          ? projects.find((candidate) => candidate.id === projectId)
          : undefined;
        const terminal = await createTerminal({
          cwd: project?.working_directory,
          projectId,
        });
        attach(terminal.id);
        await fetchTerminals();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Unable to create terminal"
        );
      }
    },
    [attach, createTerminal, fetchTerminals, projects]
  );

  const handleCloseTerminal = useCallback(
    async (sessionId: string) => {
      try {
        const closed = await killTerminal(sessionId);
        if (!closed) return;
        if (attachedSessionId === sessionId) detach();
        await fetchTerminals();
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Unable to close terminal"
        );
      }
    },
    [attachedSessionId, detach, fetchTerminals, killTerminal]
  );

  const renderPane = useCallback(
    () => (
      <Pane
        terminals={terminals}
        projects={projects}
        onRegisterTerminal={registerTerminalRef}
        onMenuClick={isMobile ? () => setSidebarOpenState(true) : undefined}
        onSelectTerminal={attachToTerminal}
        onNewTerminal={() => void handleNewTerminal()}
      />
    ),
    [
      attachToTerminal,
      handleNewTerminal,
      isMobile,
      projects,
      registerTerminalRef,
      terminals,
    ]
  );

  const viewProps = {
    terminals,
    projects,
    sidebarOpen,
    setSidebarOpen: (open: boolean) => setSidebarOpenState(open),
    activeTerminal,
    attachToTerminal,
    handleNewTerminal,
    handleCloseTerminal,
    fetchTerminals,
    handleDetachTerminal,
    renderPane,
  };

  const content = isMobile ? (
    <MobileView {...viewProps} />
  ) : (
    <DesktopView {...viewProps} />
  );

  return (
    <>
      {authRequired && (
        <AuthGate onSubmit={authenticate} initialError={authError} />
      )}
      {content}
    </>
  );
}

function AuthGate({
  onSubmit,
  initialError,
}: {
  onSubmit: (token: string) => Promise<void>;
  initialError: string | null;
}) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(initialError);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await onSubmit(token);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Token rejected");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ambient-canvas materialize fixed inset-0 z-[200] flex items-center justify-center p-6">
      <form
        className="glass-thick glass-float glass-refract lift-in w-full max-w-sm rounded-2xl p-6"
        onSubmit={(event) => void submit(event)}
      >
        <div className="text-primary mb-4 font-mono text-lg leading-none">{">_"}</div>
        <span className="ui-label">Private workspace</span>
        <h1 className="type-title-2 mt-2">Enter access token</h1>
        <p className="text-muted-foreground mt-1 text-[0.8125rem]">
          This workspace requires the Rust control-plane token.
        </p>
        <Input
          autoFocus
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="PROJECTCLIBOX_AUTH_TOKEN"
          aria-label="Access token"
          autoComplete="current-password"
          className="mt-5"
        />
        <Button type="submit" disabled={busy || !token} className="mt-3 w-full">
          {busy ? "Connecting…" : "Unlock workspace"}
        </Button>
        {message && (
          <p className="text-destructive mt-3 text-[0.75rem]" role="alert">
            {message}
          </p>
        )}
      </form>
    </div>
  );
}

export function App() {
  return (
    <PaneProvider>
      <HomeContent />
    </PaneProvider>
  );
}
