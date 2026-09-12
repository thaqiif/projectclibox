import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, File, Folder, Save, X } from "lucide-react";
import { api } from "./api";
import type { FileNode, Project } from "./protocol";

interface FileExplorerProps {
  project?: Project;
  onDirtyChange?: (dirty: boolean) => void;
}

export function FileExplorer({ project, onDirtyChange }: FileExplorerProps) {
  const projectId = project?.id;
  const [path, setPath] = useState("");
  const [files, setFiles] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const directoryRequestRef = useRef(0);
  const editorRequestRef = useRef(0);
  const saveRequestRef = useRef(0);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const load = useCallback(async () => {
    if (!projectId) return;
    const requestId = ++directoryRequestRef.current;
    setLoading(true);
    setMessage(null);
    try {
      const page = await api.files(projectId, path);
      if (requestId !== directoryRequestRef.current) return;
      setFiles(page.files);
    } catch (error) {
      if (requestId !== directoryRequestRef.current) return;
      setMessage(error instanceof Error ? error.message : "Unable to list this folder");
    } finally {
      if (requestId === directoryRequestRef.current) setLoading(false);
    }
  }, [path, projectId]);

  useEffect(() => { void load(); }, [load]);

  const openFile = async (file: FileNode) => {
    if (dirty && !window.confirm("Discard unsaved file changes?")) return;
    if (file.type === "directory") {
      editorRequestRef.current += 1;
      setOpenPath(null);
      setDirty(false);
      setPath(file.relative_path);
      return;
    }
    if (!project) return;
    const requestId = ++editorRequestRef.current;
    const requestedProjectId = project.id;
    const requestedPath = file.relative_path;
    try {
      const result = await api.file(requestedProjectId, requestedPath);
      if (requestId !== editorRequestRef.current) return;
      setOpenPath(requestedPath);
      setContent(result.content);
      setDirty(false);
      setMessage(result.is_binary ? "Binary files are read-only in the editor." : null);
    } catch (error) {
      if (requestId !== editorRequestRef.current) return;
      setMessage(error instanceof Error ? error.message : "Unable to open this file");
    }
  };

  const save = async () => {
    if (!project || !openPath || !dirty) return;
    const requestId = editorRequestRef.current;
    const saveRequestId = ++saveRequestRef.current;
    const requestedProjectId = project.id;
    const requestedPath = openPath;
    const requestedContent = content;
    setSaving(true);
    try {
      await api.saveFile(requestedProjectId, requestedPath, requestedContent);
      if (requestId !== editorRequestRef.current) return;
      setDirty(false);
      setMessage("Saved");
    } catch (error) {
      if (requestId !== editorRequestRef.current) return;
      setMessage(error instanceof Error ? error.message : "Unable to save this file");
    } finally {
      if (saveRequestId === saveRequestRef.current) setSaving(false);
    }
  };

  if (!project) return <EmptyStage title="Choose a project" detail="Files stay inside an authorized project root." />;
  const parent = path ? path.split("/").slice(0, -1).join("/") : null;
  return (
    <div className="file-workspace">
      <div className="file-browser">
        <div className="stage-heading">
          <div>
            <span className="eyebrow">Workspace files</span>
            <h2>{project.name}</h2>
          </div>
          <span className="path-chip">{path || "."}</span>
        </div>
        {parent !== null && (
          <button className="file-row back-row" onClick={() => setPath(parent)}><ArrowLeft size={15} /> Parent folder</button>
        )}
        {loading && <div className="empty-copy">Reading directory…</div>}
        {!loading && files.map((file) => (
          <button key={file.relative_path} className="file-row" onClick={() => void openFile(file)}>
            {file.type === "directory" ? <Folder size={15} /> : <File size={15} />}
            <span>{file.name}</span>
            {file.type === "file" && <small>{formatBytes(file.size ?? 0)}</small>}
          </button>
        ))}
        {!loading && files.length === 0 && <div className="empty-copy">No visible files in this folder.</div>}
        {message && <div className="inline-message">{message}</div>}
      </div>
      <div className="file-editor">
        <div className="editor-heading">
          <span className="path-chip">{openPath || "No file open"}</span>
          <div className="editor-actions">
            {dirty && <span className="dirty-mark">Unsaved</span>}
            {openPath && <button className="icon-button" title="Close file" onClick={() => {
              if (dirty && !window.confirm("Discard unsaved file changes?")) return;
              editorRequestRef.current += 1;
              setOpenPath(null);
              setDirty(false);
            }}><X size={16} /></button>}
            <button className="button button-small" disabled={!dirty || saving} onClick={() => void save()}><Save size={14} /> {saving ? "Saving" : "Save"}</button>
          </div>
        </div>
        {openPath ? (
          <textarea
            className="code-editor"
            value={content}
            spellCheck={false}
            onChange={(event) => { editorRequestRef.current += 1; setContent(event.target.value); setDirty(true); }}
            aria-label={`Editing ${openPath}`}
          />
        ) : <EmptyStage title="Open a file" detail="The editor is loaded only when you ask for it." />}
      </div>
    </div>
  );
}

function EmptyStage({ title, detail }: { title: string; detail: string }) {
  return <div className="empty-stage"><div className="empty-glyph">›_</div><h2>{title}</h2><p>{detail}</p></div>;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
