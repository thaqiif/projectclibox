export interface NewProjectDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (projectId: string) => void;
}

export const RECENT_DIRS_KEY = "clibox:recentDirectories";
export const MAX_RECENT_DIRS = 5;
