import type {
  DirectoryPage,
  FileContent,
  Project,
  Session,
} from "./protocol";
import { toTerminalRecord } from "./lib/terminals";
import type { TerminalRecord } from "./lib/terminals";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const AUTH_REQUIRED_EVENT = "projectclibox:auth-required";
export const AUTH_RESTORED_EVENT = "projectclibox:auth-restored";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers,
  });
  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!response.ok) {
    if (response.status === 401) {
      window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
    }
    const message =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error?: unknown }).error)
        : `Request failed (${response.status})`;
    throw new ApiError(
      message,
      response.status,
      typeof body === "object" && body !== null && "code" in body
        ? String((body as { code?: unknown }).code)
        : undefined
    );
  }
  return body as T;
}

function sessionList(
  value: Session[] | { sessions?: Session[] }
): TerminalRecord[] {
  const sessions = Array.isArray(value) ? value : value.sessions ?? [];
  return sessions.map(toTerminalRecord);
}

function fileParams(projectId: string | undefined, path: string) {
  const params = new URLSearchParams({ path });
  if (projectId) params.set("projectId", projectId);
  return params;
}

export const api = {
  async projects(): Promise<Project[]> {
    const result = await request<{ projects?: Project[] } | Project[]>(
      "/api/projects"
    );
    return Array.isArray(result) ? result : result.projects ?? [];
  },

  authenticate: (token: string) =>
    request<void>("/api/auth", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),

  createProject: (body: {
    name: string;
    working_directory: string;
  }) =>
    request<Project>("/api/projects", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  updateProject: (
    projectId: string,
    body: {
      name: string;
      working_directory: string;
      expanded?: boolean;
    }
  ) =>
    request<Project>(`/api/projects/${encodeURIComponent(projectId)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  deleteProject: (projectId: string) =>
    request<void>(`/api/projects/${encodeURIComponent(projectId)}`, {
      method: "DELETE",
    }),

  async sessions(): Promise<TerminalRecord[]> {
    return sessionList(
      await request<Session[] | { sessions?: Session[] }>("/api/terminals")
    );
  },

  async createSession(body: {
    cwd?: string;
    projectId?: string;
    name?: string;
    command?: string[];
  }): Promise<TerminalRecord> {
    const session = await request<Session>("/api/terminals", {
      method: "POST",
      body: JSON.stringify({
        cwd: body.cwd,
        project_id: body.projectId,
        name: body.name,
        command: body.command,
      }),
    });
    return toTerminalRecord(session);
  },

  terminate: async (id: string) =>
    toTerminalRecord(
      await request<Session>(
        `/api/terminals/${encodeURIComponent(id)}/terminate`,
        { method: "POST" }
      )
    ),

  restart: async (id: string) =>
    toTerminalRecord(
      await request<Session>(
        `/api/terminals/${encodeURIComponent(id)}/restart`,
        { method: "POST" }
      )
    ),

  deleteMetadata: (id: string) =>
    request<void>(`/api/terminals/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),

  rename: async (id: string, name: string) =>
    toTerminalRecord(
      await request<Session>(`/api/terminals/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ name }),
      })
    ),

  files: (
    projectId: string | undefined,
    path = "",
    cursor?: string | null,
    limit?: number
  ) => {
    const params = fileParams(projectId, path);
    if (cursor) params.set("cursor", cursor);
    if (limit) params.set("limit", String(limit));
    return request<DirectoryPage>(`/api/files?${params.toString()}`);
  },

  file: (projectId: string | undefined, path: string) =>
    request<FileContent>(
      `/api/files/content?${fileParams(projectId, path).toString()}`
    ),

  saveFile: (projectId: string | undefined, path: string, content: string) =>
    request<{ success: boolean; size: number }>("/api/files/content", {
      method: "PUT",
      body: JSON.stringify({ projectId, path, content }),
    }),

  uploadFile: async (
    projectId: string | undefined,
    path: string,
    file: File
  ) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return request<{
      success: boolean;
      path: string;
      relative_path: string;
      size: number;
    }>(
      "/api/files/upload",
      {
        method: "POST",
        body: JSON.stringify({
          projectId,
          path,
          data: btoa(binary),
        }),
      }
    );
  },

  settings: () => request<Record<string, string>>("/api/settings"),

  setSetting: (key: string, value: string) =>
    request<void>("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ key, value }),
    }),
};

export type { DirectoryPage, FileContent, Project, Session, TerminalRecord };
