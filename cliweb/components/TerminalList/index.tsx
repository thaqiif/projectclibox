"use client";

import { useState, useMemo } from "react";
import {
  ProjectsSection,
  NewProjectDialog,
  ProjectSettingsDialog,
} from "@/components/Projects";
import { FolderPicker } from "@/components/FolderPicker";
import { TerminalListHeader } from "./TerminalListHeader";
import { KillAllConfirm } from "./KillAllConfirm";
import { useTerminalListMutations } from "./hooks/useTerminalListMutations";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ProjectSectionSkeleton } from "@/components/ui/skeleton";
import { FolderPlus, TriangleAlert } from "lucide-react";
import { AEmptyState } from "@/components/a/AEmptyState";
import type { TerminalRecord } from "@/lib/terminals";
import type { Project } from "@/lib/db";

import { useTerminalsQuery } from "@/data/terminals";
import { useProjectsQuery, useCreateProject } from "@/data/projects";

import type { TerminalListProps } from "./TerminalList.types";

export function TerminalList({
  activeTerminalId,
  onSelect,
  onNewTerminal,
  onCloseTerminal,
  enableTerminalDrag = false,
  onClosedAllTerminals,
}: TerminalListProps) {
  const {
    data: terminalsData,
    isPending: isTerminalsPending,
    isError: isTerminalsError,
    error: terminalsError,
  } = useTerminalsQuery();
  const {
    data: projects = [],
    isPending: isProjectsPending,
    isError: isProjectsError,
  } = useProjectsQuery();
  const isInitialLoading = isTerminalsPending || isProjectsPending;
  const hasError = isTerminalsError || isProjectsError;

  const terminals = useMemo<TerminalRecord[]>(
    () => terminalsData ?? [],
    [terminalsData]
  );

  // All mutations via custom hook
  const mutations = useTerminalListMutations();
  const createProject = useCreateProject();

  const [showNewProjectDialog, setShowNewProjectDialog] = useState(false);
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [showKillAllConfirm, setShowKillAllConfirm] = useState(false);

  const useProjectsView = projects.length > 0;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <TerminalListHeader
        onNewProject={() => {
          setShowNewProjectDialog(true);
        }}
        onOpenProject={() => setShowFolderPicker(true)}
        onKillAll={() => setShowKillAllConfirm(true)}
      />

      {/* Kill All Confirmation */}
      {showKillAllConfirm && (
        <KillAllConfirm
          onCancel={() => setShowKillAllConfirm(false)}
          onComplete={() => {
            setShowKillAllConfirm(false);
            onClosedAllTerminals?.();
          }}
        />
      )}

      {/* Terminal list */}
      <ScrollArea className="w-full flex-1">
        <div className="scrollbar-thin max-w-full px-2 py-2">
          {/* Loading state */}
          {isInitialLoading && <ProjectSectionSkeleton count={2} />}

          {/* Error state */}
          {hasError && !isInitialLoading && (
            <AEmptyState
              size="compact"
              tone="error"
              icon={TriangleAlert}
              title="Couldn't load terminals"
              description={terminalsError?.message || "Unknown error"}
              action={{ label: "Try again", onClick: mutations.handleRefresh }}
            />
          )}

          {/* Empty state */}
          {!isInitialLoading &&
            !hasError &&
            terminals.length === 0 &&
            projects.length <= 1 && (
              <AEmptyState
                size="compact"
                icon={FolderPlus}
                title="No terminals yet"
                description="Create a project to group the terminals you run in it."
                action={{
                  label: "New project",
                  icon: FolderPlus,
                  onClick: () => setShowNewProjectDialog(true),
                }}
              />
            )}

          {/* Content - Projects view */}
          {!isInitialLoading && !hasError && useProjectsView && (
            <ProjectsSection
              projects={projects}
              terminals={terminals}
              activeTerminalId={activeTerminalId}
              onToggleProject={mutations.handleToggleProject}
              onEditProject={(projectId) => {
                const project = projects.find((p) => p.id === projectId);
                if (project) setEditingProject(project);
              }}
              onDeleteProject={mutations.handleDeleteProject}
              onRenameProject={mutations.handleRenameProject}
              onNewTerminal={onNewTerminal}
              onSelectTerminal={onSelect}
              onCloseTerminal={
                onCloseTerminal ?? mutations.handleDeleteTerminal
              }
              onRenameTerminal={mutations.handleRenameTerminal}
              enableTerminalDrag={enableTerminalDrag}
            />
          )}
        </div>
      </ScrollArea>
      {/* New Project Dialog */}
      <NewProjectDialog
        open={showNewProjectDialog}
        onClose={() => setShowNewProjectDialog(false)}
        onCreated={() => setShowNewProjectDialog(false)}
      />

      {/* Folder Picker for Open Project */}
      {showFolderPicker && (
        <FolderPicker
          initialPath="~"
          onClose={() => setShowFolderPicker(false)}
          onSelect={(path) => {
            // Derive project name from folder path
            const parts = path.split("/").filter(Boolean);
            const name = parts[parts.length - 1] || "project";

            createProject.mutate(
              {
                name,
                workingDirectory: path,
              },
              {
                onSuccess: () => setShowFolderPicker(false),
                onError: (err) => {
                  console.error("Failed to create project:", err);
                  setShowFolderPicker(false);
                },
              }
            );
          }}
        />
      )}

      {/* Project Settings Dialog */}
      <ProjectSettingsDialog
        key={editingProject?.id ?? "project-settings"}
        project={editingProject}
        open={editingProject !== null}
        onClose={() => setEditingProject(null)}
        onSave={() => setEditingProject(null)}
      />
    </div>
  );
}
