import type { Project } from "@/lib/db";

/**
 * Which project a terminal belongs to.
 *
 * Terminals have no stored project link any more — they are backed by tmux,
 * and tmux only knows a working directory. So the association is derived:
 * the project whose working directory is the longest prefix of the
 * terminal's path. Longest wins so that a project nested inside another
 * (a repo inside a workspace root) claims its own terminals.
 */
export function resolveProjectForPath(
  path: string,
  projects: Project[]
): string | null {
  let best: { id: string; length: number } | null = null;

  for (const project of projects) {
    const dir = project.working_directory.replace(/\/+$/, "");
    if (!dir) continue;

    // Prefix match on path segments, so /srv/app-2 does not match /srv/app.
    if (path !== dir && !path.startsWith(`${dir}/`)) continue;

    if (!best || dir.length > best.length) {
      best = { id: project.id, length: dir.length };
    }
  }

  return best?.id ?? null;
}
