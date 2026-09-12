import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api";
import type { TerminalRecord } from "../../lib/terminals";
import { terminalKeys } from "./keys";

async function fetchTerminals(): Promise<TerminalRecord[]> {
  return api.sessions();
}

export function useTerminalsQuery() {
  return useQuery({
    queryKey: terminalKeys.list(),
    queryFn: fetchTerminals,
    refetchInterval: 15000,
    placeholderData: (previous) => previous,
  });
}

export function useCreateTerminal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (opts: { cwd?: string; projectId?: string }) =>
      api.createSession(opts),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: terminalKeys.all });
    },
  });
}

export function useKillTerminal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      // DELETE is authoritative: the backend stops a live PTY and removes
      // both live and stale persisted sessions in one operation.
      await api.deleteMetadata(id);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: terminalKeys.all });
    },
  });
}

export function useRenameTerminal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, newName }: { name: string; newName: string }) => {
      const terminal = await api.rename(name, newName);
      return { name: terminal.name, requested: newName };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: terminalKeys.all });
    },
  });
}
