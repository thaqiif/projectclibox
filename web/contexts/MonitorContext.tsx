"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useMonitorWorkspace } from "@/hooks/useMonitorWorkspace";

type MonitorContextValue = ReturnType<typeof useMonitorWorkspace>;

const MonitorContext = createContext<MonitorContextValue | null>(null);

/** The monitor workspace is the whole workbench, so one instance is shared by the views and anything deeper that changes which terminals it shows. */
export function MonitorProvider({ children }: { children: ReactNode }) {
  const monitor = useMonitorWorkspace();
  return (
    <MonitorContext.Provider value={monitor}>
      {children}
    </MonitorContext.Provider>
  );
}

export function useMonitor() {
  const context = useContext(MonitorContext);
  if (!context) {
    throw new Error("useMonitor must be used within a MonitorProvider");
  }
  return context;
}
