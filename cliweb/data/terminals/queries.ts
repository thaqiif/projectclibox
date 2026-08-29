import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TerminalRecord } from "@/lib/terminals";
import { terminalKeys } from "./keys";

async function fetchTerminals(): Promise<TerminalRecord[]> {
  const res = await fetch("/api/terminals");
  if (!res.ok) throw new Error("Failed to fetch terminals");
  return res.json();
}

/**
 * The terminal list.
 *
 * tmux owns this, so it can change without the UI doing anything — someone
 * running `tmux new` in a shell, or a terminal exiting. A modest refetch
 * interval keeps the list honest; status liveness comes over SSE separately.
 */
export function useTerminalsQuery() {
  return useQuery({
    queryKey: terminalKeys.list(),
    queryFn: fetchTerminals,
    refetchInterval: 5000,
    placeholderData: (prev) => prev,
  });
}

export function useCreateTerminal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (opts: {
      cwd?: string;
      projectId?: string;
    }): Promise<TerminalRecord> => {
      const res = await fetch("/api/terminals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(opts),
      });
      if (!res.ok) throw new Error("Failed to create terminal");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: terminalKeys.all });
    },
  });
}

export function useKillTerminal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch(`/api/terminals/${encodeURIComponent(name)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to kill terminal");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: terminalKeys.all });
    },
  });
}

export function useRenameTerminal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      name,
      newName,
    }: {
      name: string;
      newName: string;
    }) => {
      const res = await fetch(`/api/terminals/${encodeURIComponent(name)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newName }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || "Failed to rename terminal");
      }

      // The name tmux settled on, which is not always the one asked for.
      return body as { name: string; requested: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: terminalKeys.all });
    },
  });
}
