import type { AgentType } from "./providers";

export interface ModelOption {
  value: string;
  label: string;
}

// Models belong to installed CLIs, not to this shell-only workspace UI.
export function getModelOptions(_agentType: AgentType): ModelOption[] {
  return [];
}

export function getDefaultModelForAgent(_agentType: AgentType): string {
  return "";
}

export function isSupportedModelForAgent(
  _agentType: AgentType,
  _model: string | null | undefined
): boolean {
  return false;
}

export function resolveModelForAgent(
  _agentType: AgentType,
  _model: string | null | undefined
): string {
  return "";
}
