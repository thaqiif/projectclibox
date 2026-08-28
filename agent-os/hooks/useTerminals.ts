import { useCallback } from "react";
import {
  useTerminalsQuery,
  useCreateTerminal,
  useKillTerminal,
  useRenameTerminal,
} from "@/data/terminals";
import type { TerminalRecord } from "@/lib/terminals";

export function useTerminals() {
  const { data, refetch } = useTerminalsQuery();
  const terminals: TerminalRecord[] = data ?? [];

  const createMutation = useCreateTerminal();
  const killMutation = useKillTerminal();
  const renameMutation = useRenameTerminal();

  const fetchTerminals = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const createTerminal = useCallback(
    async (opts: { cwd?: string; projectId?: string } = {}) => {
      return await createMutation.mutateAsync(opts);
    },
    [createMutation]
  );

  const killTerminal = useCallback(
    async (name: string) => {
      // Killing a tmux terminal takes its processes with it, so make sure
      // that is what was meant.
      if (!confirm("Close this terminal? Anything running in it is killed."))
        return;
      await killMutation.mutateAsync(name);
    },
    [killMutation]
  );

  const renameTerminal = useCallback(
    async (name: string, newName: string) => {
      await renameMutation.mutateAsync({ name, newName });
    },
    [renameMutation]
  );

  return {
    terminals,
    fetchTerminals,
    createTerminal,
    killTerminal,
    renameTerminal,
  };
}
