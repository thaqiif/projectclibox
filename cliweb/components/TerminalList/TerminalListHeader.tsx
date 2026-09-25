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
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface TerminalListHeaderProps {
  onNewProject: () => void;
  onOpenProject: () => void;
  onKillAll: () => void;
  onCloseSidebar?: () => void;
}

export function TerminalListHeader({
  onNewProject,
  onOpenProject,
  onKillAll,
  onCloseSidebar,
}: TerminalListHeaderProps) {
  const [showThemeDialog, setShowThemeDialog] = useState(false);
  const [showSettingsDialog, setShowSettingsDialog] = useState(false);

  return (
    <div className="glass-edge-bottom px-3 py-2">
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
              menuItem(
                "Settings…",
                () => {
                  onCloseSidebar?.();
                  setShowSettingsDialog(true);
                },
                {
                  icon: Settings,
                }
              ),
              menuItem(
                "Theme…",
                () => {
                  onCloseSidebar?.();
                  setShowThemeDialog(true);
                },
                {
                  icon: Palette,
                }
              ),
              separator(),
              menuItem("Close all terminals", onKillAll, {
                icon: Trash2,
                variant: "destructive",
              }),
            ]}
          />
          {onCloseSidebar && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Close sidebar"
              onClick={onCloseSidebar}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
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
