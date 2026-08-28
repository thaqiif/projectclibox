import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useKillTerminal } from "@/data/terminals";
import { useTerminalRename } from "@/hooks/useTerminalRename";
import {
  useToggleProject,
  useDeleteProject,
  useRenameProject,
} from "@/data/projects";
import {
  useStopDevServer,
  useRestartDevServer,
  useRemoveDevServer,
} from "@/data/dev-servers";
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

  const stopDevServerMutation = useStopDevServer();
  const restartDevServerMutation = useRestartDevServer();
  const removeDevServerMutation = useRemoveDevServer();

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

  const handleStopDevServer = useCallback(
    async (id: string) => {
      await stopDevServerMutation.mutateAsync(id);
    },
    [stopDevServerMutation]
  );

  const handleRestartDevServer = useCallback(
    async (id: string) => {
      await restartDevServerMutation.mutateAsync(id);
    },
    [restartDevServerMutation]
  );

  const handleRemoveDevServer = useCallback(
    async (id: string) => {
      await removeDevServerMutation.mutateAsync(id);
    },
    [removeDevServerMutation]
  );

  const handleBulkDelete = useCallback(
    async (names: string[]) => {
      const count = names.length;
      const toastId = toast.loading(
        `Closing ${count} terminal${count > 1 ? "s" : ""}...`
      );

      let succeeded = 0;
      let failed = 0;

      await Promise.allSettled(
        names.map(async (name) => {
          try {
            const response = await fetch(
              `/api/terminals/${encodeURIComponent(name)}`,
              { method: "DELETE" }
            );
            if (response.ok) succeeded++;
            else failed++;
          } catch (error) {
            console.error(`Failed to close terminal ${name}:`, error);
            failed++;
          }
        })
      );

      queryClient.invalidateQueries({ queryKey: terminalKeys.all });

      if (failed === 0) {
        toast.success(`Closed ${succeeded} terminal${succeeded > 1 ? "s" : ""}`, {
          id: toastId,
        });
      } else if (succeeded === 0) {
        toast.error(`Failed to close ${failed} terminal${failed > 1 ? "s" : ""}`, {
          id: toastId,
        });
      } else {
        toast.warning(
          `Closed ${succeeded}, failed ${failed} terminal${failed > 1 ? "s" : ""}`,
          { id: toastId }
        );
      }
    },
    [queryClient]
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

    handleStopDevServer,
    handleRestartDevServer,
    handleRemoveDevServer,

    handleBulkDelete,
    handleRefresh,
  };
}
