import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  Activity,
  ChevronDown,
  ChevronRight,
  Columns3,
  FileCode2,
  FolderGit2,
  Monitor,
  Moon,
  Plus,
  RotateCcw,
  Settings,
  Square,
  Sun,
  Terminal as TerminalIcon,
  X,
} from "lucide-react";
import { AUTH_REQUIRED_EVENT, AUTH_RESTORED_EVENT, ApiError, api } from "./api";
import { FileExplorer } from "./FileExplorer";
import { TerminalPane } from "./TerminalPane";
import type { Project, Session, SessionStatus } from "./protocol";

type ViewMode = "terminal" | "files" | "monitor";

export function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>("uncategorized");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [monitorIds, setMonitorIds] = useState<string[]>([]);
  const [view, setView] = useState<ViewMode>("terminal");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [dark, setDark] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectPath, setNewProjectPath] = useState("/workspaces");
  const [savingProject, setSavingProject] = useState(false);
  const [fileEditorDirty, setFileEditorDirty] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const authRequiredRef = useRef(false);
  const viewRef = useRef(view);
  const fileEditorDirtyRef = useRef(fileEditorDirty);

  viewRef.current = view;
  fileEditorDirtyRef.current = fileEditorDirty;

  const refresh = useCallback(async (initial = false) => {
    if (authRequiredRef.current) return;
    if (initial) setLoading(true);
    try {
      const [nextProjects, nextSessions] = await Promise.all([api.projects(), api.sessions()]);
      setProjects(nextProjects);
      setSessions(nextSessions);
      setSelectedProjectId((current) => nextProjects.some((project) => project.id === current) ? current : (nextProjects[0]?.id ?? "uncategorized"));
      setActiveSessionId((current) => current && nextSessions.some((session) => session.id === current) ? current : pickInitialSession(nextSessions));
      setMonitorIds((current) => current.filter((id) => nextSessions.some((session) => session.id === id)));
      setError(null);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) {
        authRequiredRef.current = true;
        setAuthRequired(true);
        setError(null);
        return;
      }
      setError(reason instanceof Error ? reason.message : "Unable to reach ProjectCliBox");
    } finally {
      if (initial) setLoading(false);
    }
  }, []);

  const authenticate = async (token: string) => {
    try {
      await api.authenticate(token);
      authRequiredRef.current = false;
      setAuthRequired(false);
      setError(null);
      // Re-authentication must not enter the initial loading branch: that
      // would unmount FileExplorer and discard an unsaved editor buffer.
      await refresh();
      window.dispatchEvent(new Event(AUTH_RESTORED_EVENT));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to authenticate");
      throw reason;
    }
  };

  useEffect(() => { void refresh(true); }, [refresh]);
  useEffect(() => {
    const onAuthRequired = () => {
      authRequiredRef.current = true;
      setAuthRequired(true);
      setError(null);
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => { void refresh(); }, 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (viewRef.current !== "files" || !fileEditorDirtyRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);

  const activeSession = sessions.find((session) => session.id === activeSessionId);
  const selectedProject = projects.find((project) => project.id === selectedProjectId);
  const projectSessions = useMemo(
    () => sessions.filter((session) => (session.project_id ?? "uncategorized") === selectedProjectId),
    [selectedProjectId, sessions],
  );

  const updateSession = useCallback((id: string, update: Partial<Session>) => {
    setSessions((current) => current.map((session) => session.id === id ? { ...session, ...update } : session));
  }, []);

  const createSession = async () => {
    if (view === "files" && fileEditorDirty && !window.confirm("Discard unsaved file changes and open a terminal?")) return;
    try {
      const session = await api.createSession({ project_id: selectedProjectId });
      setSessions((current) => [...current, session]);
      if (!confirmDiscardFileChanges()) return;
      setActiveSessionId(session.id);
      setView("terminal");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create terminal");
    }
  };

  const createProject = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!newProjectName.trim() || savingProject || !confirmDiscardFileChanges()) return;
    setSavingProject(true);
    try {
      const project = await api.createProject({
        name: newProjectName.trim(),
        working_directory: newProjectPath.trim() || "/workspaces",
      });
      setProjects((current) => [...current, project]);
      if (!confirmDiscardFileChanges()) return;
      setSelectedProjectId(project.id);
      setNewProjectName("");
      setNewProjectOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create project");
    } finally {
      setSavingProject(false);
    }
  };

  const terminate = async (session: Session) => {
    if (!window.confirm(`Stop ${session.name}? The process group will receive SIGTERM first.`)) return;
    try {
      const stopped = await api.terminate(session.id);
      updateSession(session.id, stopped);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to stop session");
    }
  };

  const restart = async (session: Session) => {
    try {
      const replacement = await api.restart(session.id);
      setSessions((current) => [...current, replacement]);
      setActiveSessionId(replacement.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to restart session");
    }
  };

  const rename = async (session: Session) => {
    const name = window.prompt("Session name", session.name)?.trim();
    if (!name || name === session.name) return;
    try {
      updateSession(session.id, await api.rename(session.id, name));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to rename session");
    }
  };

  const toggleMonitor = () => {
    if (view === "monitor") {
      setView("terminal");
      return;
    }
    if (!confirmDiscardFileChanges()) return;
    const initial = activeSessionId ? [activeSessionId] : projectSessions.filter(isLive).slice(0, 1).map((session) => session.id);
    setMonitorIds((ids) => ids.length ? ids : initial);
    setView("monitor");
  };

  const changeView = (nextView: ViewMode) => {
    if (nextView !== view && !confirmDiscardFileChanges()) return;
    setView(nextView);
  };

  const selectSession = (id: string) => {
    if (!confirmDiscardFileChanges()) return;
    setActiveSessionId(id);
    setView("terminal");
    setSidebarOpen(false);
  };

  const openMonitor = (id: string) => {
    if (!confirmDiscardFileChanges()) return;
    setMonitorIds((ids) => ids.includes(id) ? ids : [...ids, id].slice(0, 3));
    setView("monitor");
  };

  function confirmDiscardFileChanges() {
    return viewRef.current !== "files" || !fileEditorDirtyRef.current || window.confirm("Discard unsaved file changes?");
  }

  const handleFileEditorDirtyChange = useCallback((dirty: boolean) => {
    fileEditorDirtyRef.current = dirty;
    setFileEditorDirty(dirty);
  }, []);

  const selectProject = (id: string) => {
    if (id !== selectedProjectId && !confirmDiscardFileChanges()) return;
    setSelectedProjectId(id);
  };

  return (
    <div className={`app-shell ${sidebarOpen ? "sidebar-visible" : "sidebar-hidden"}`}>
      {authRequired && <AuthGate onSubmit={authenticate} />}
      <aside className="sidebar" aria-label="Project and session navigation">
        <div className="brand-row">
          <div className="brand-mark">›_</div>
          <div className="brand-copy"><strong>ProjectCliBox</strong><span>terminal runtime</span></div>
          <button className="icon-button mobile-only" aria-label="Close navigation" onClick={() => setSidebarOpen(false)}><X size={17} /></button>
        </div>
        <div className="sidebar-actions">
          <button className="button button-primary" onClick={() => void createSession()}><Plus size={16} /> New terminal</button>
          <span className="runtime-pill"><span className="status-dot status-dot-live" /> supervisor online</span>
        </div>
        <div className="nav-scroll">
          <div className="section-label"><span>Projects <em>{projects.length}</em></span><button className="section-add" title="New project" onClick={() => setNewProjectOpen((value) => !value)}><Plus size={13} /></button></div>
          {newProjectOpen && <form className="project-form" onSubmit={(event) => void createProject(event)}>
            <input autoFocus value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} placeholder="Project name" aria-label="Project name" maxLength={120} />
            <input value={newProjectPath} onChange={(event) => setNewProjectPath(event.target.value)} placeholder="/workspaces/project" aria-label="Project folder" />
            <div className="project-form-actions"><button className="button button-small button-primary" type="submit" disabled={savingProject}>{savingProject ? "Adding…" : "Add project"}</button><button className="button button-small" type="button" onClick={() => setNewProjectOpen(false)}>Cancel</button></div>
          </form>}
          {projects.map((project) => (
            <ProjectSection
              key={project.id}
              project={project}
              selected={selectedProjectId === project.id}
              sessions={sessions.filter((session) => (session.project_id ?? "uncategorized") === project.id)}
              activeId={activeSessionId}
              onSelectProject={(id) => selectProject(id)}
              onSelectSession={selectSession}
              onOpenMonitor={openMonitor}
              onStop={(session) => void terminate(session)}
              onRestart={(session) => void restart(session)}
              onRename={(session) => void rename(session)}
            />
          ))}
        </div>
        <div className="sidebar-footer">
          <div className="footer-metric"><Activity size={14} /><span>{sessions.filter(isLive).length} live sessions</span></div>
          <div className="footer-actions"><button className="icon-button" title="Toggle theme" onClick={() => setDark((value) => !value)}>{dark ? <Sun size={16} /> : <Moon size={16} />}</button><button className="icon-button" title="Settings"><Settings size={16} /></button></div>
        </div>
      </aside>

      <main className="main-stage">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button menu-button" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}><TerminalIcon size={17} /></button>
            {activeSession ? <><span className={`status-orb orb-${activeSession.status}`} /><span className="topbar-title">{activeSession.name}</span><span className="topbar-meta">{selectedProject?.name ?? "Uncategorized"}</span></> : <span className="topbar-title">Workspace</span>}
          </div>
          <div className="topbar-actions">
            <button className={`view-button ${view === "terminal" ? "view-active" : ""}`} onClick={() => changeView("terminal")}><TerminalIcon size={15} /> Terminal</button>
            <button className={`view-button ${view === "files" ? "view-active" : ""}`} onClick={() => changeView("files")} disabled={!selectedProject}><FileCode2 size={15} /> Files</button>
            <button className={`view-button ${view === "monitor" ? "view-active" : ""}`} onClick={toggleMonitor}><Columns3 size={15} /> Monitor</button>
          </div>
        </header>

        {error && <div className="error-banner" role="alert"><span>{error}</span><button className="icon-button" onClick={() => setError(null)}><X size={15} /></button></div>}
        <section className="content-stage">
          {loading ? <div className="empty-stage"><div className="loading-ring" /><h2>Opening workspace</h2><p>Connecting to the local supervisor.</p></div> : view === "files" ? <FileExplorer key={selectedProjectId} project={selectedProject} onDirtyChange={handleFileEditorDirtyChange} /> : view === "monitor" ? (
            <MonitorView ids={monitorIds} sessions={sessions} onSessionUpdate={updateSession} onRemove={(id) => setMonitorIds((current) => current.filter((item) => item !== id))} />
          ) : activeSession ? (
            <div className="terminal-stage"><div className="stage-heading terminal-heading"><div><span className="eyebrow">Attached viewer</span><h1>{activeSession.name}</h1></div><SessionSummary session={activeSession} onStop={() => void terminate(activeSession)} onRestart={() => void restart(activeSession)} onRename={() => void rename(activeSession)} /></div><div className="terminal-frame"><TerminalPane session={activeSession} onSessionUpdate={updateSession} /></div></div>
          ) : <Welcome project={selectedProject} onCreate={() => void createSession()} />}
        </section>
      </main>
    </div>
  );
}

const ProjectSection = memo(function ProjectSection({ project, selected, sessions, activeId, onSelectProject, onSelectSession, onOpenMonitor, onStop, onRestart, onRename }: {
  project: Project; selected: boolean; sessions: Session[]; activeId: string | null;
  onSelectProject: (id: string) => void; onSelectSession: (id: string) => void; onOpenMonitor: (id: string) => void;
  onStop: (session: Session) => void; onRestart: (session: Session) => void; onRename: (session: Session) => void;
}) {
  const [expanded, setExpanded] = useState(project.expanded || selected);
  return <div className={`project-section ${selected ? "project-selected" : ""}`}>
    <button className="project-row" onClick={() => { setExpanded((value) => !value); onSelectProject(project.id); }}>
      {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<FolderGit2 size={15} /><span>{project.name}</span><small>{sessions.length}</small>
    </button>
    {expanded && <div className="session-list">{sessions.map((session) => <SessionRow key={session.id} session={session} active={activeId === session.id} onSelect={() => onSelectSession(session.id)} onOpenMonitor={() => onOpenMonitor(session.id)} onStop={() => onStop(session)} onRestart={() => onRestart(session)} onRename={() => onRename(session)} />)}{sessions.length === 0 && <div className="no-sessions">No terminals yet</div>}</div>}
  </div>;
});

const SessionRow = memo(function SessionRow({ session, active, onSelect, onOpenMonitor, onStop, onRestart, onRename }: {
  session: Session; active: boolean; onSelect: () => void; onOpenMonitor: () => void; onStop: () => void; onRestart: () => void; onRename: () => void;
}) {
  const live = isLive(session);
  return <div className={`session-row ${active ? "session-active" : ""}`}>
    <button className="session-main" onClick={onSelect}><span className={`status-dot status-${session.status}`} /><span className="session-label"><strong>{session.name}</strong><small>{statusLabel(session)}</small></span></button>
    <div className="session-actions"><button className="row-icon" title="Rename" onClick={onRename}>···</button><button className="row-icon" title="Open in monitor" onClick={onOpenMonitor}><Monitor size={13} /></button>{live ? <button className="row-icon danger-hover" title="Stop session" onClick={onStop}><Square size={12} /></button> : <button className="row-icon" title="Restart session" onClick={onRestart}><RotateCcw size={13} /></button>}</div>
  </div>;
});

function MonitorView({ ids, sessions, onSessionUpdate, onRemove }: { ids: string[]; sessions: Session[]; onSessionUpdate: (id: string, update: Partial<Session>) => void; onRemove: (id: string) => void; }) {
  const monitorSessions = ids.map((id) => sessions.find((session) => session.id === id)).filter((session): session is Session => Boolean(session));
  return <div className="monitor-stage"><div className="stage-heading"><div><span className="eyebrow">Shared view</span><h1>Monitor workspace</h1></div><span className="monitor-count">{monitorSessions.length}/3 panels</span></div>{monitorSessions.length ? <div className={`monitor-grid monitor-${monitorSessions.length}`}>{monitorSessions.map((session) => <div className="monitor-panel" key={session.id}><div className="monitor-panel-header"><span className={`status-dot status-${session.status}`} /><span className="monitor-name">{session.name}</span><span className="monitor-stats">{session.cpu_percent === null ? "—" : `${session.cpu_percent.toFixed(1)}%`} · {formatBytes(session.memory_bytes ?? 0)} · {session.process_count ?? "—"} proc</span><span className="monitor-viewers">{session.attached_viewers} viewers</span><button className="row-icon" onClick={() => onRemove(session.id)} title="Remove panel"><X size={13} /></button></div><div className="monitor-terminal"><TerminalPane session={session} compact onSessionUpdate={onSessionUpdate} /></div></div>)}</div> : <div className="empty-stage"><div className="empty-glyph"><Columns3 size={32} /></div><h2>Add a session to monitor</h2><p>Use the monitor button on any terminal. Every panel attaches to the same PTY.</p></div>}</div>;
}

function SessionSummary({ session, onStop, onRestart, onRename }: { session: Session; onStop: () => void; onRestart: () => void; onRename: () => void; }) {
  return <div className="session-summary"><div className="summary-stat"><span>Status</span><strong>{statusLabel(session)}</strong></div><div className="summary-stat"><span>Runtime</span><strong>{formatDuration(session.runtime_ms)}</strong></div><div className="summary-stat"><span>Viewers</span><strong>{session.attached_viewers}</strong></div><div className="summary-actions"><button className="icon-button" onClick={onRename} title="Rename"><Settings size={15} /></button>{isLive(session) ? <button className="button button-small button-stop" onClick={onStop}><Square size={13} /> Stop</button> : <button className="button button-small" onClick={onRestart}><RotateCcw size={13} /> Restart</button>}</div></div>;
}

function Welcome({ project, onCreate }: { project?: Project; onCreate: () => void }) {
  return <div className="empty-stage welcome-stage"><div className="welcome-mark">›_</div><span className="eyebrow">{project?.name ?? "ProjectCliBox"}</span><h1>A terminal that keeps running.</h1><p>Close the browser, come back later, and reconnect to the same process. Open a shell in {project?.name ?? "your workspace"} to begin.</p><button className="button button-primary" onClick={onCreate}><Plus size={16} /> Open terminal</button></div>;
}

function AuthGate({ onSubmit }: { onSubmit: (token: string) => Promise<void> }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await onSubmit(token);
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "Token rejected");
    } finally {
      setBusy(false);
    }
  };
  return <div className="auth-overlay"><form className="auth-card" onSubmit={(event) => void submit(event)}><div className="welcome-mark">›_</div><span className="eyebrow">Private workspace</span><h1>Enter access token</h1><p>The Rust control plane is protected because it is reachable beyond loopback.</p><input autoFocus type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="PROJECTCLIBOX_AUTH_TOKEN" aria-label="Access token" autoComplete="current-password" /><button className="button button-primary" type="submit" disabled={busy || !token}>{busy ? "Connecting…" : "Unlock workspace"}</button>{message && <div className="auth-error" role="alert">{message}</div>}</form></div>;
}

function pickInitialSession(sessions: Session[]) { return sessions.find(isLive)?.id ?? sessions[0]?.id ?? null; }
function isLive(session: Session) { return ["starting", "running", "idle", "disconnected", "terminating"].includes(session.status); }
function statusLabel(session: Session) {
  if (session.status === "exited") return `Exited${session.exit_code === null ? "" : ` ${session.exit_code}`}`;
  if (session.status === "failed") return `Failed${session.exit_code === null ? "" : ` ${session.exit_code}`}`;
  if (session.status === "terminating") return "Stopping";
  if (session.status === "disconnected") return "Disconnected · still running";
  if (session.status === "idle") return `Idle · ${formatDuration(session.runtime_ms)}`;
  return `Running · ${formatDuration(session.runtime_ms)}`;
}
function formatDuration(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatBytes(bytes: number) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
