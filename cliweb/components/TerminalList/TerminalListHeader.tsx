"use client";

import Image from "next/image";
import { useState } from "react";
import {
  ADropdownMenu,
  menuItem,
  separator,
} from "@/components/a/ADropdownMenu";
import { ThemeDialog } from "@/components/ThemeDialog";
import { SettingsDialog } from "@/components/SettingsDialog";
import {
  Plus,
  FolderPlus,
  FolderOpen,
  MoreHorizontal,
  Trash2,
  Palette,
  Settings,
  Command,
} from "lucide-react";

interface TerminalListHeaderProps {
  onNewProject: () => void;
  onOpenProject: () => void;
  onKillAll: () => void;
  onQuickSwitch?: () => void;
}

export function TerminalListHeader({
  onNewProject,
  onOpenProject,
  onKillAll,
  onQuickSwitch,
}: TerminalListHeaderProps) {
  const [showThemeDialog, setShowThemeDialog] = useState(false);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);

  return (
    <div className="px-3 pt-3 pb-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Image
            src="/branding/cliweb-terminal.svg"
            alt=""
            width={18}
            height={18}
            aria-hidden="true"
            className="h-[1.125rem] w-[1.125rem]"
          />
          <h2 className="text-[0.9375rem] font-semibold tracking-[-0.014em]">
            CLIWeb
          </h2>
        </div>
        <div className="flex items-center gap-0.5">
          <ADropdownMenu
            icon={Plus}
            tooltip="New project"
            items={[
              menuItem("New Project", onNewProject, { icon: FolderPlus }),
              menuItem("Open Project", onOpenProject, { icon: FolderOpen }),
            ]}
          />
          <ADropdownMenu
            icon={MoreHorizontal}
            tooltip="More options"
            items={[
              ...(onQuickSwitch
                ? [
                    menuItem("Quick switch  ⌘K", onQuickSwitch, {
                      icon: Command,
                    }),
                  ]
                : []),
              menuItem("Settings…", () => setShowSettingsDialog(true), {
                icon: Settings,
              }),
              menuItem("Theme…", () => setShowThemeDialog(true), {
                icon: Palette,
              }),
              separator(),
              menuItem("Close all terminals", onKillAll, {
                icon: Trash2,
                variant: "destructive",
              }),
            ]}
          />
        </div>
      </div>

      <ThemeDialog open={showThemeDialog} onOpenChange={setShowThemeDialog} />
      <SettingsDialog
        open={showSettingsDialog}
        onOpenChange={setShowSettingsDialog}
      />
    </div>
  );
}
