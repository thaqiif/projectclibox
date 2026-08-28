"use client";

import { cn } from "@/lib/utils";

export type GitTab = "changes" | "history";

interface GitPanelTabsProps {
  activeTab: GitTab;
  onTabChange: (tab: GitTab) => void;
}

const TABS: { id: GitTab; label: string }[] = [
  { id: "changes", label: "Changes" },
  { id: "history", label: "History" },
];

export function GitPanelTabs({ activeTab, onTabChange }: GitPanelTabsProps) {
  return (
    <div className="glass glass-edge-bottom relative z-10 flex shrink-0 items-stretch">
      {TABS.map((tab, index) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={cn(
            "relative flex h-9 flex-1 items-center justify-center px-3 text-[0.75rem] font-medium transition-colors sm:flex-none",
            index > 0 && "border-l border-[var(--fill-2)]",
            activeTab === tab.id
              ? "bg-background text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {tab.label}
          {activeTab === tab.id && (
            <span className="bg-primary absolute inset-x-0 bottom-0 h-px" />
          )}
        </button>
      ))}
    </div>
  );
}
