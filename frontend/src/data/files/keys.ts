export const fileKeys = {
  all: ["files"] as const,
  list: (projectId: string | undefined, path: string) =>
    [...fileKeys.all, projectId ?? "workspace", "list", path] as const,
};
