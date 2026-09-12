import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { terminalKeys } from "@/data/terminals/keys";
import { api } from "@/api";
import { toast } from "sonner";

interface KillAllConfirmProps {
  onCancel: () => void;
  onComplete: () => void;
}

export function KillAllConfirm({ onCancel, onComplete }: KillAllConfirmProps) {
  const queryClient = useQueryClient();
  const [killing, setKilling] = useState(false);

  const handleKillAll = async () => {
    setKilling(true);
    try {
      const terminals = await api.sessions();
      const results = await Promise.allSettled(
        terminals.map((terminal) => api.deleteMetadata(terminal.id))
      );
      await queryClient.invalidateQueries({ queryKey: terminalKeys.all });

      const failures = results.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected"
      );
      if (failures.length > 0) {
        const reason = failures[0].reason;
        const message =
          reason instanceof Error ? reason.message : "Deletion failed";
        toast.error(
          `${failures.length} terminal${failures.length === 1 ? "" : "s"} could not be deleted`,
          { description: message }
        );
        return;
      }

      onComplete();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to close terminals"
      );
    } finally {
      setKilling(false);
    }
  };

  return (
    <div className="bg-destructive/8 mx-3 mb-2 rounded-xl p-3">
      <p className="text-[0.8125rem] font-medium tracking-[-0.006em]">
        Close every terminal?
      </p>
      <p className="text-muted-foreground mt-0.5 mb-2.5 text-[0.75rem] leading-relaxed">
        Anything still running in them stops.
      </p>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="destructive"
          onClick={handleKillAll}
          disabled={killing}
        >
          {killing ? "Closing..." : "Yes, close all"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={killing}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
