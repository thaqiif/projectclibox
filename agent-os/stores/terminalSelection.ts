import { proxy } from "valtio";
import { updateSelection } from "@/lib/rangeSelectionUtils";

// Store state
export const selectionStore = proxy({
  selectedIds: new Set<string>(),
  lastSelectedId: null as string | null,
});

// Actions - can be called from anywhere
export const selectionActions = {
  toggle: (
    terminalId: string,
    shiftKey = false,
    allTerminalIds: string[] = []
  ) => {
    const newSet = updateSelection(
      selectionStore.selectedIds,
      terminalId,
      shiftKey,
      selectionStore.lastSelectedId,
      allTerminalIds
    );
    selectionStore.selectedIds = newSet;
    selectionStore.lastSelectedId = terminalId;
  },

  selectAll: (terminalIds: string[]) => {
    selectionStore.selectedIds = new Set(terminalIds);
  },

  clear: () => {
    selectionStore.selectedIds = new Set();
    selectionStore.lastSelectedId = null;
  },

  isSelected: (terminalId: string) => {
    return selectionStore.selectedIds.has(terminalId);
  },

  getCount: () => {
    return selectionStore.selectedIds.size;
  },

  getSelectedIds: () => {
    return Array.from(selectionStore.selectedIds);
  },
};
