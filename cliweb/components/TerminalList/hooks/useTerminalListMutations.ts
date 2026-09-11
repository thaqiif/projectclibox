import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useKillTerminal } from "@/data/terminals";
import { useTerminalRename } from "@/hooks/useTerminalRename";
import {
  useToggleProject,
  useDeleteProject,
  useRenameProject,
} from "@/data/projects";
import { terminalKeys } from "@/data/terminals/keys";

/**
 * Sidebar mutations.
 *
 * Terminals are tmux workspaces, so "delete" is `tmux kill-session` and
 * "rename" is `tmux rename-session`. Fork, summarize and move-to-project
 * went with the old database table: a terminal's project is derived from its
 * working directory, and there is nothing stored to fork or summarize.
 */
export function useTerminalListMutations() {
  const queryClient = useQueryClient();

  const killTerminalMutation = useKillTerminal();
  const renameTerminal = useTerminalRename();

  const toggleProjectMutation = useToggleProject();
  const deleteProjectMutation = useDeleteProject();
  const renameProjectMutation = useRenameProject();

  const handleDeleteTerminal = useCallback(
    async (name: string) => {
      if (!confirm("Close this terminal? Anything running in it is killed."))
        return;
      await killTerminalMutation.mutateAsync(name);
    },
    [killTerminalMutation]
  );

  const handleRenameTerminal = renameTerminal;

  const handleToggleProject = useCallback(
    async (projectId: string, expanded: boolean) => {
      await toggleProjectMutation.mutateAsync({ projectId, expanded });
    },
    [toggleProjectMutation]
  );

  const handleDeleteProject = useCallback(
    async (projectId: string) => {
      if (!confirm("Delete this project? Terminals are not affected.")) return;
      await deleteProjectMutation.mutateAsync(projectId);
    },
    [deleteProjectMutation]
  );

  const handleRenameProject = useCallback(
    async (projectId: string, name: string) => {
      await renameProjectMutation.mutateAsync({ projectId, newName: name });
    },
    [renameProjectMutation]
  );

  const handleRefresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: terminalKeys.all });
  }, [queryClient]);

  return {
    handleDeleteTerminal,
    handleRenameTerminal,

    handleToggleProject,
    handleDeleteProject,
    handleRenameProject,

    handleRefresh,
  };
}
