"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import { useRenameTerminal } from "@/data/terminals";

/**
 * Rename a terminal from anywhere in the UI.
 *
 * Shared by the sidebar's inline rename and the workbench title. The
 * backend-native session id remains stable across a rename, so only the
 * displayed record changes.
 */
export function useTerminalRename() {
  const renameTerminalMutation = useRenameTerminal();

  return useCallback(
    async (name: string, newName: string) => {
      if (!newName.trim() || newName === name) return;

      try {
        const result = await renameTerminalMutation.mutateAsync({
          name,
          newName,
        });

        if (result.name !== result.requested) {
          toast.info(`Renamed to "${result.name}"`);
        }
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to rename terminal"
        );
      }
    },
    [renameTerminalMutation]
  );
}
