"use client";

import { useMemo, useCallback } from "react";
import { useSnapshot } from "valtio";
import { ProjectCard } from "./ProjectCard";
import { TerminalCard } from "@/components/TerminalCard";
import { selectionStore, selectionActions } from "@/stores/terminalSelection";
import type { Project } from "@/lib/db";
import type { TerminalRecord } from "@/lib/terminals";

export interface ProjectsSectionProps {
  projects: Project[];
  terminals: TerminalRecord[];
  /** tmux name of the terminal currently attached. */
  activeTerminalId?: string;
  onToggleProject?: (projectId: string, expanded: boolean) => void;
  onEditProject?: (projectId: string) => void;
  onDeleteProject?: (projectId: string) => void;
  onRenameProject?: (projectId: string, newName: string) => void;
  onNewTerminal?: (projectId?: string) => void;
  onSelectTerminal: (name: string) => void;
  onCloseTerminal?: (name: string) => void;
  onRenameTerminal?: (name: string, newName: string) => void;
}

export function ProjectsSection({
  projects,
  terminals,
  activeTerminalId,
  onToggleProject,
  onEditProject,
  onDeleteProject,
  onRenameProject,
  onNewTerminal,
  onSelectTerminal,
  onCloseTerminal,
  onRenameTerminal,
}: ProjectsSectionProps) {
  const { selectedIds } = useSnapshot(selectionStore);
  const isInSelectMode = selectedIds.size > 0;

  // Flatten all terminal IDs for range selection (respecting render order)
  const allTerminalIds = useMemo(() => {
    const ids: string[] = [];
    for (const project of projects) {
      const projectTerminals = terminals.filter(
        (terminal) => (terminal.project_id || "uncategorized") === project.id
      );
      for (const terminal of projectTerminals) ids.push(terminal.id);
    }
    return ids;
  }, [projects, terminals]);

  // Handler for toggling terminal selection
  const handleToggleSelect = useCallback(
    (terminalId: string, shiftKey: boolean) => {
      selectionActions.toggle(terminalId, shiftKey, allTerminalIds);
    },
    [allTerminalIds]
  );

  // Group terminals by the project their working directory falls under.
  const terminalsByProject = terminals.reduce(
    (acc, terminal) => {
      const projectId = terminal.project_id || "uncategorized";
      if (!acc[projectId]) acc[projectId] = [];
      acc[projectId].push(terminal);
      return acc;
    },
    {} as Record<string, TerminalRecord[]>
  );

  return (
    <div className="flex flex-col gap-1">
      {projects.map((project) => {
        const projectTerminals = terminalsByProject[project.id] || [];

        return (
          <div key={project.id} className="flex flex-col gap-0.5">
            {/* Project header */}
            <ProjectCard
              project={project}
              onToggleExpanded={(expanded) =>
                onToggleProject?.(project.id, expanded)
              }
              onEdit={
                !project.is_uncategorized && onEditProject
                  ? () => onEditProject(project.id)
                  : undefined
              }
              onNewTerminal={
                onNewTerminal ? () => onNewTerminal(project.id) : undefined
              }
              onDelete={
                !project.is_uncategorized && onDeleteProject
                  ? () => onDeleteProject(project.id)
                  : undefined
              }
              onRename={
                onRenameProject
                  ? (newName) => onRenameProject(project.id, newName)
                  : undefined
              }
            />

            {/* Project contents when expanded */}
            {project.expanded && (
              <div className="ml-4 flex flex-col gap-0.5 pb-1 pl-1.5">
                {/* Project terminals */}
                {projectTerminals.length === 0 ? (
                  <p className="text-muted-foreground px-2.5 py-1.5 text-[0.75rem]">
                    No terminals yet
                  </p>
                ) : (
                  projectTerminals.map((terminal) => (
                    <div key={terminal.id} className="min-w-0">
                      <TerminalCard
                        terminal={terminal}
                        isActive={terminal.id === activeTerminalId}
                        isSelected={selectedIds.has(terminal.id)}
                        isInSelectMode={isInSelectMode}
                        onToggleSelect={(shiftKey) =>
                          handleToggleSelect(terminal.id, shiftKey)
                        }
                        onClick={() => onSelectTerminal(terminal.id)}
                        onDelete={
                          onCloseTerminal
                            ? () => onCloseTerminal(terminal.id)
                            : undefined
                        }
                        onRename={
                          onRenameTerminal
                            ? (newName) =>
                                onRenameTerminal(terminal.id, newName)
                            : undefined
                        }
                      />
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
