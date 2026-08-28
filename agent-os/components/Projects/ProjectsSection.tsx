"use client";

import { useMemo, useCallback } from "react";
import { useSnapshot } from "valtio";
import { ProjectCard } from "./ProjectCard";
import { TerminalCard } from "@/components/TerminalCard";
import { DevServerCard } from "@/components/DevServers/DevServerCard";
import { selectionStore, selectionActions } from "@/stores/terminalSelection";
import type { DevServer } from "@/lib/db";
import type { TerminalRecord } from "@/lib/terminals";
import type { ProjectWithDevServers } from "@/lib/projects";

export interface ProjectsSectionProps {
  projects: ProjectWithDevServers[];
  terminals: TerminalRecord[];
  /** tmux name of the terminal currently attached. */
  activeTerminalId?: string;
  devServers?: DevServer[];
  onToggleProject?: (projectId: string, expanded: boolean) => void;
  onEditProject?: (projectId: string) => void;
  onDeleteProject?: (projectId: string) => void;
  onRenameProject?: (projectId: string, newName: string) => void;
  onNewTerminal?: (projectId?: string) => void;
  onSelectTerminal: (name: string) => void;
  onCloseTerminal?: (name: string) => void;
  onRenameTerminal?: (name: string, newName: string) => void;
  onStartDevServer?: (projectId: string) => void;
  onStopDevServer?: (serverId: string) => Promise<void>;
  onRestartDevServer?: (serverId: string) => Promise<void>;
  onRemoveDevServer?: (serverId: string) => Promise<void>;
  onViewDevServerLogs?: (serverId: string) => void;
}

export function ProjectsSection({
  projects,
  terminals,
  activeTerminalId,
  devServers = [],
  onToggleProject,
  onEditProject,
  onDeleteProject,
  onRenameProject,
  onNewTerminal,
  onSelectTerminal,
  onCloseTerminal,
  onRenameTerminal,
  onStartDevServer,
  onStopDevServer,
  onRestartDevServer,
  onRemoveDevServer,
  onViewDevServerLogs,
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

  // Get running dev servers for a project (for ProjectCard badge)
  const getProjectRunningServers = (projectId: string): DevServer[] => {
    return devServers.filter(
      (ds) => ds.project_id === projectId && ds.status === "running"
    );
  };

  // Get all dev servers for a project
  const getProjectDevServers = (projectId: string): DevServer[] => {
    return devServers.filter((ds) => ds.project_id === projectId);
  };

  return (
    <div className="flex flex-col gap-1">
      {projects.map((project) => {
        const projectTerminals = terminalsByProject[project.id] || [];
        const runningServers = getProjectRunningServers(project.id);
        const projectDevServers = getProjectDevServers(project.id);

        return (
          <div key={project.id} className="flex flex-col gap-0.5">
            {/* Project header */}
            <ProjectCard
              project={project}
              runningDevServers={runningServers}
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
              onStartDevServer={
                !project.is_uncategorized && onStartDevServer
                  ? () => onStartDevServer(project.id)
                  : undefined
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
                {/* Dev servers for this project */}
                {projectDevServers.length > 0 && (
                  <div className="flex flex-col gap-0.5 pb-0.5">
                    {projectDevServers.map((server) => (
                      <DevServerCard
                        key={server.id}
                        server={server}
                        onStart={
                          onRestartDevServer
                            ? (id) => onRestartDevServer(id)
                            : async () => {}
                        }
                        onStop={onStopDevServer || (async () => {})}
                        onRestart={onRestartDevServer || (async () => {})}
                        onRemove={onRemoveDevServer || (async () => {})}
                        onViewLogs={
                          onViewDevServerLogs
                            ? (id) => onViewDevServerLogs(id)
                            : () => {}
                        }
                      />
                    ))}
                  </div>
                )}

                {/* Project terminals */}
                {projectTerminals.length === 0 &&
                projectDevServers.length === 0 ? (
                  <p className="text-muted-foreground px-2.5 py-1.5 text-[0.75rem]">
                    No terminals yet
                  </p>
                ) : projectTerminals.length === 0 ? null : (
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
