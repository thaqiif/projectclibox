/**
 * Project persistence and working-directory validation.
 *
 * Projects group terminals by their working directory. Runtime commands are
 * intentionally started from the terminal instead of being managed here.
 */

import fs from "fs";
import {
  db,
  queries,
  type Project,
} from "./db";

export interface CreateProjectOptions {
  name: string;
  workingDirectory: string;
}

function normalizeProject(project: Project): Project {
  return {
    ...project,
    expanded: Boolean(project.expanded),
    is_uncategorized: Boolean(project.is_uncategorized),
  };
}

function generateProjectId(): string {
  return `proj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function createProject(opts: CreateProjectOptions): Project {
  const id = generateProjectId();
  const projects = queries.getAllProjects(db).all() as Project[];
  const maxOrder = projects.reduce((max, project) =>
    Math.max(max, project.sort_order), 0
  );
  queries
    .createProject(db)
    .run(
      id,
      opts.name,
      opts.workingDirectory,
      maxOrder + 1
    );

  return normalizeProject(queries.getProject(db).get(id) as Project);
}

export function getProject(id: string): Project | undefined {
  const project = queries.getProject(db).get(id) as Project | undefined;
  return project ? normalizeProject(project) : undefined;
}

export function getAllProjects(): Project[] {
  return (queries.getAllProjects(db).all() as Project[]).map(normalizeProject);
}

export function updateProject(
  id: string,
  updates: Partial<
    Pick<Project, "name" | "working_directory">
  >
): Project | undefined {
  const project = getProject(id);
  if (!project || project.is_uncategorized) return undefined;

  queries
    .updateProject(db)
    .run(
      updates.name ?? project.name,
      updates.working_directory ?? project.working_directory,
      id
    );

  return getProject(id);
}

export function toggleProjectExpanded(id: string, expanded: boolean): void {
  queries.updateProjectExpanded(db).run(expanded ? 1 : 0, id);
}

export function deleteProject(id: string): boolean {
  const project = getProject(id);
  if (!project || project.is_uncategorized) return false;

  queries.deleteProject(db).run(id);
  return true;
}

export function validateWorkingDirectory(directory: string): boolean {
  const expandedDirectory = directory.replace(/^~/, process.env.HOME || "~");
  try {
    return (
      fs.existsSync(expandedDirectory) &&
      fs.statSync(expandedDirectory).isDirectory()
    );
  } catch {
    return false;
  }
}
