export const MONITOR_WORKSPACE_SETTING_KEY = "desktopMonitorWorkspace";
const MIN_MONITOR_PANES = 1;
export const MAX_MONITOR_PANES = 3;

export interface MonitorPaneState {
  id: string;
  terminalId: string | null;
  width: number;
}

export interface MonitorWorkspaceState {
  enabled: boolean;
  panes: MonitorPaneState[];
}

export const DEFAULT_MONITOR_WORKSPACE: MonitorWorkspaceState = {
  enabled: false,
  panes: [{ id: "monitor-1", terminalId: null, width: 1 }],
};

function equalizeWidths(panes: MonitorPaneState[]): MonitorPaneState[] {
  const width = 1 / panes.length;
  return panes.map((pane) => ({ ...pane, width }));
}

/** Validate and normalize a stored client payload: pane count, unique ids, unique terminal ownership, positive widths renormalized to sum to 1. */
export function normalizeMonitorWorkspace(
  input: unknown
): MonitorWorkspaceState {
  if (!input || typeof input !== "object") {
    throw new Error("Workspace must be an object");
  }

  const candidate = input as { enabled?: unknown; panes?: unknown };
  if (
    typeof candidate.enabled !== "boolean" ||
    !Array.isArray(candidate.panes)
  ) {
    throw new Error("Workspace requires enabled and panes");
  }
  if (
    candidate.panes.length < MIN_MONITOR_PANES ||
    candidate.panes.length > MAX_MONITOR_PANES
  ) {
    throw new Error("Workspace must contain one to three panes");
  }

  const terminalIds = new Set<string>();
  const paneIds = new Set<string>();
  const panes = candidate.panes.map((value) => {
    if (!value || typeof value !== "object") throw new Error("Invalid pane");
    const pane = value as {
      id?: unknown;
      terminalId?: unknown;
      width?: unknown;
    };
    if (typeof pane.id !== "string" || !pane.id.trim()) {
      throw new Error("Each pane requires an id");
    }
    const id = pane.id.trim();
    if (paneIds.has(id)) {
      throw new Error("Duplicate pane id");
    }
    paneIds.add(id);
    if (pane.terminalId !== null && typeof pane.terminalId !== "string") {
      throw new Error("Invalid terminal identity");
    }
    if (pane.terminalId) {
      if (terminalIds.has(pane.terminalId)) {
        throw new Error("A terminal can only occupy one pane");
      }
      terminalIds.add(pane.terminalId);
    }
    if (
      typeof pane.width !== "number" ||
      !Number.isFinite(pane.width) ||
      pane.width <= 0
    ) {
      throw new Error("Pane widths must be positive numbers");
    }
    return {
      id,
      terminalId: pane.terminalId || null,
      width: pane.width,
    };
  });

  return {
    enabled: candidate.enabled,
    panes: equalizeWidths(panes),
  };
}

export function assignMonitorTerminal(
  workspace: MonitorWorkspaceState,
  paneId: string,
  terminalId: string
): MonitorWorkspaceState {
  const occupyingPane = workspace.panes.find(
    (pane) => pane.terminalId === terminalId && pane.id !== paneId
  );
  if (occupyingPane) return workspace;
  return {
    ...workspace,
    panes: workspace.panes.map((pane) =>
      pane.id === paneId ? { ...pane, terminalId } : pane
    ),
  };
}

export function removeMonitorPane(
  workspace: MonitorWorkspaceState,
  paneId: string
): MonitorWorkspaceState {
  if (workspace.panes.length <= MIN_MONITOR_PANES) return workspace;
  if (!workspace.panes.some((pane) => pane.id === paneId)) return workspace;
  const panes = workspace.panes.filter((pane) => pane.id !== paneId);
  return {
    ...workspace,
    panes: equalizeWidths(panes),
  };
}

export type MonitorDropSide = "before" | "center" | "after";
const MONITOR_EDGE_ZONE = 0.25;

export function dropSideFromRatio(ratio: number): MonitorDropSide {
  if (ratio < MONITOR_EDGE_ZONE) return "before";
  if (ratio > 1 - MONITOR_EDGE_ZONE) return "after";
  return "center";
}


function newPaneId(): string {
  return `monitor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function clearMonitorTerminal(
  workspace: MonitorWorkspaceState,
  terminalId: string
): MonitorWorkspaceState {
  return {
    ...workspace,
    panes: workspace.panes.map((pane) =>
      pane.terminalId === terminalId ? { ...pane, terminalId: null } : pane
    ),
  };
}

function placeMonitorTerminal(
  workspace: MonitorWorkspaceState,
  paneId: string,
  terminalId: string
): MonitorWorkspaceState {
  return assignMonitorTerminal(
    clearMonitorTerminal(workspace, terminalId),
    paneId,
    terminalId
  );
}

function insertMonitorPane(
  workspace: MonitorWorkspaceState,
  anchorPaneId: string,
  side: Exclude<MonitorDropSide, "center">,
  terminalId: string
): MonitorWorkspaceState {
  const anchorIndex = workspace.panes.findIndex(
    (pane) => pane.id === anchorPaneId
  );
  if (anchorIndex < 0) return workspace;
  if (workspace.panes.length >= MAX_MONITOR_PANES) {
    return placeMonitorTerminal(workspace, anchorPaneId, terminalId);
  }

  const cleared = clearMonitorTerminal(workspace, terminalId);
  const insertAt = side === "before" ? anchorIndex : anchorIndex + 1;
  const panes = [...cleared.panes];
  panes.splice(insertAt, 0, {
    id: newPaneId(),
    terminalId,
    width: 1,
  });
  return { ...cleared, panes: equalizeWidths(panes) };
}

export function dropMonitorTerminal(
  workspace: MonitorWorkspaceState,
  paneId: string,
  terminalId: string,
  side: MonitorDropSide
): MonitorWorkspaceState {
  const target = workspace.panes.find((pane) => pane.id === paneId);
  if (!target) return workspace;
  if (side !== "center" && target.terminalId) {
    return insertMonitorPane(workspace, paneId, side, terminalId);
  }
  return placeMonitorTerminal(workspace, paneId, terminalId);
}

export function moveMonitorPane(
  workspace: MonitorWorkspaceState,
  sourcePaneId: string,
  anchorPaneId: string,
  side: MonitorDropSide
): MonitorWorkspaceState {
  if (sourcePaneId === anchorPaneId) return workspace;
  const sourceIndex = workspace.panes.findIndex(
    (pane) => pane.id === sourcePaneId
  );
  const anchorIndex = workspace.panes.findIndex(
    (pane) => pane.id === anchorPaneId
  );
  if (sourceIndex < 0 || anchorIndex < 0) return workspace;

  const panes = [...workspace.panes];
  const [moved] = panes.splice(sourceIndex, 1);
  let insertAt = side === "before" ? anchorIndex : anchorIndex + 1;
  if (sourceIndex < insertAt) insertAt -= 1;
  if (side === "center") insertAt = panes.findIndex((pane) => pane.id === anchorPaneId);
  if (insertAt < 0) insertAt = 0;
  panes.splice(insertAt, 0, moved);
  return { ...workspace, panes: equalizeWidths(panes) };
}

