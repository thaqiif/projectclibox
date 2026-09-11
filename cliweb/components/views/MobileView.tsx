"use client";

import { TerminalList } from "@/components/TerminalList";
import { MobileSidebar } from "@/components/mobile/MobileSidebar";
import type { ViewProps } from "./types";

export function MobileView({
  sidebarOpen,
  setSidebarOpen,
  activeTerminal,
  attachToTerminal,
  handleNewTerminal,
  handleCloseTerminal,
  renderPane,
}: ViewProps) {
  return (
    <main className="bg-background h-app flex flex-col overflow-hidden">
      {/* Sidebar */}
      <MobileSidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)}>
        <div className="flex h-full flex-col">
          {/* Terminal list */}
          <div className="min-h-0 flex-1 overflow-hidden">
            <TerminalList
              activeTerminalId={activeTerminal?.id}
              onSelect={(id) => {
                attachToTerminal(id);
              }}
              onNewTerminal={handleNewTerminal}
              onCloseTerminal={handleCloseTerminal}
            />
          </div>
        </div>
      </MobileSidebar>

      {/* Terminal fills the screen */}
      <div className="min-h-0 w-full flex-1">{renderPane()}</div>
    </main>
  );
}
