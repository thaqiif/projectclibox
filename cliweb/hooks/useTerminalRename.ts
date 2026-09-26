"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import { useRenameTerminal } from "@/data/terminals";
import { useMonitor } from "@/contexts/MonitorContext";

/**
 * Rename a terminal from anywhere in the UI.
 *
 * Shared by the sidebar's inline rename and the monitor panes, so both
 * handle the same two facts the same way: tmux may hand back a different
 * name than the one asked for, and the workbench's pointer is the terminal's
 * tmux name, so the pane showing it has to move with it.
 */
export function useTerminalRename() {
  const renameTerminalMutation = useRenameTerminal();
  const { renameTerminal } = useMonitor();

  return useCallback(
    async (name: string, newName: string) => {
      if (!newName.trim() || newName === name) return;

      try {
        const result = await renameTerminalMutation.mutateAsync({
          name,
          newName,
        });

        // tmux rewrites "." and ":" in terminal names. Say so rather than
        // letting the name quietly come back different from what was typed.
        if (result.name !== result.requested) {
          toast.info(`Renamed to "${result.name}"`, {
            description: "tmux terminal names cannot contain . or :",
          });
        }

        // A terminal is identified by its tmux name, so a pane showing it
        // would point at a name that no longer exists. The tmux client is
        // still attached to the same terminal; only the pointer moves.
        renameTerminal(name, result.name);
      } catch (error) {
        toast.error(
          error instanceof Error ? error.message : "Failed to rename terminal"
        );
      }
    },
    [renameTerminalMutation, renameTerminal]
  );
}
