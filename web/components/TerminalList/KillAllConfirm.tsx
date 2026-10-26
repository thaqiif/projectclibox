import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { terminalKeys } from "@/data/terminals/keys";

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
      await fetch("/api/tmux/kill-all", { method: "POST" });
      await queryClient.invalidateQueries({ queryKey: terminalKeys.all });
      onComplete();
    } catch (error) {
      console.error("Failed to kill terminals:", error);
    } finally {
      setKilling(false);
    }
  };

  return (
    <div className="bg-destructive/8 mx-3 mb-2 rounded-xl p-3">
      <p className="text-[0.8125rem] font-medium tracking-[-0.006em]">
        Close every tmux terminal?
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
          {killing ? "Killing..." : "Yes, kill all"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={killing}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
