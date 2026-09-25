"use client";

import { Plus, Terminal as TerminalIcon } from "lucide-react";
import type { TerminalRecord } from "@/lib/terminals";
import { cn } from "@/lib/utils";

interface WelcomeProps {
  terminals: TerminalRecord[];
  onNewTerminal: () => void;
  onSelectTerminal: (name: string) => void;
}

const RECENT_LIMIT = 6;

/**
 * What the workbench shows when it is not attached to anything.
 *
 * Before this, an unattached workbench still rendered a live terminal — a
 * bare shell that looked like a tmux terminal but was not one, so anything
 * typed into it vanished on refresh. Showing nothing at all is more honest,
 * and gives closing a terminal somewhere to land.
 *
 * The empty workbench offers one clear next action. On narrow screens the
 * content sits directly on the canvas, without a card around empty space.
 */
export function Welcome({
  terminals,
  onNewTerminal,
  onSelectTerminal,
}: WelcomeProps) {
  // Most recently active first; tmux reports activity in epoch seconds.
  const recent = [...terminals]
    .sort((a, b) => b.activity - a.activity)
    .slice(0, RECENT_LIMIT);

  return (
    <div className="ambient-canvas flex h-full w-full items-center justify-center overflow-auto p-5">
      <div className="welcome-panel glass-thick glass-float lift-in w-full max-w-sm rounded-md p-6">
        <h1 className="type-title-2">CLIWeb Workspace</h1>
        <p className="text-muted-foreground mt-1 text-[0.8125rem]">
          Create a terminal or open a recent one.
        </p>

        <div className="mt-5 flex flex-col gap-1">
          <button
            onClick={onNewTerminal}
            className="press focus-ring flex items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-[0.8125rem] font-medium transition-colors hover:bg-[var(--fill-3)]"
          >
            <Plus className="text-primary h-4 w-4 shrink-0" />
            New terminal
          </button>
        </div>

        {recent.length > 0 && (
          <div className="mt-5">
            <span className="ui-label px-2.5">Recent</span>
            <div className="mt-1.5 flex flex-col">
              {recent.map((terminal) => (
                <button
                  key={terminal.id}
                  onClick={() => onSelectTerminal(terminal.tmux_name)}
                  className="press focus-ring group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--fill-3)]"
                >
                  <TerminalIcon
                    className={cn(
                      "h-3.5 w-3.5 shrink-0",
                      terminal.alive
                        ? "text-muted-foreground"
                        : "text-muted-foreground/45"
                    )}
                  />
                  <span className="truncate text-[0.8125rem]">
                    {terminal.name}
                  </span>
                  <span className="text-muted-foreground ml-auto shrink-0 text-[0.6875rem]">
                    {terminal.alive ? "shell" : "stopped"}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
