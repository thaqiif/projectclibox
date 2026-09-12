import type { DirectoryPage, FileContent, Project, Session } from "./protocol";

export class ApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string) {
    super(message);
    this.name = "ApiError";
  }
}

export const AUTH_REQUIRED_EVENT = "projectclibox:auth-required";
export const AUTH_RESTORED_EVENT = "projectclibox:auth-restored";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(body?.error || `Request failed (${response.status})`, response.status, body?.code);
  }
  return body as T;
}

export const api = {
  async projects(): Promise<Project[]> {
    const result = await request<{ projects: Project[] }>("/api/projects");
    return result.projects;
  },
  authenticate: (token: string) =>
    request<void>("/api/auth", { method: "POST", body: JSON.stringify({ token }) }),
  createProject: (body: { name: string; working_directory: string }) =>
    request<Project>("/api/projects", { method: "POST", body: JSON.stringify(body) }),
  sessions: () => request<Session[]>("/api/terminals"),
  createSession: (body: { project_id?: string; name?: string; command?: string[] }) =>
    request<Session>("/api/terminals", { method: "POST", body: JSON.stringify(body) }),
  terminate: (id: string) =>
    request<Session>(`/api/terminals/${encodeURIComponent(id)}/terminate`, { method: "POST" }),
  restart: (id: string) =>
    request<Session>(`/api/terminals/${encodeURIComponent(id)}/restart`, { method: "POST" }),
  deleteMetadata: (id: string) =>
    request<void>(`/api/terminals/${encodeURIComponent(id)}`, { method: "DELETE" }),
  rename: (id: string, name: string) =>
    request<Session>(`/api/terminals/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
  files: (projectId: string, path = "", cursor?: string | null) => {
    const params = new URLSearchParams({ projectId, path });
    if (cursor) params.set("cursor", cursor);
    return request<DirectoryPage>(`/api/files?${params}`);
  },
  file: (projectId: string, path: string) => {
    const params = new URLSearchParams({ projectId, path });
    return request<FileContent>(`/api/files/content?${params}`);
  },
  saveFile: (projectId: string, path: string, content: string) =>
    request<{ success: boolean; size: number }>("/api/files/content", {
      method: "PUT",
      body: JSON.stringify({ projectId, path, content }),
    }),
};
