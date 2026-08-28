/**
 * Agent provider abstraction.
 *
 * The workspace image ships only a shell. AI CLIs are intentionally installed
 * manually by the user in the web terminal, so there are no built-in harness
 * definitions, launch flags, or automatic provider selection here.
 */

import {
  type ProviderId,
  type ProviderDefinition,
  getProviderDefinition,
  getAllProviderDefinitions,
  isValidProviderId,
} from "./providers/registry";

export type AgentType = ProviderId;

export interface AgentProvider {
  id: AgentType;
  name: string;
  description: string;
  command: string;
  supportsResume: boolean;
  supportsFork: boolean;
  buildFlags(options: BuildFlagsOptions): string[];
  configDir: string;
}

export interface BuildFlagsOptions {
  sessionId?: string | null;
  parentSessionId?: string | null;
  skipPermissions?: boolean;
  autoApprove?: boolean;
  model?: string;
  initialPrompt?: string;
}

export const shellProvider: AgentProvider = {
  id: "shell",
  name: "Terminal",
  description: "Plain shell terminal",
  command: "",
  configDir: "",
  supportsResume: false,
  supportsFork: false,
  buildFlags(): string[] {
    return [];
  },
};

export const providers: Record<AgentType, AgentProvider> = {
  shell: shellProvider,
};

export function getProvider(_agentType: AgentType): AgentProvider {
  return shellProvider;
}

export function getAllProviders(): AgentProvider[] {
  return [shellProvider];
}

export function isValidAgentType(value: string): value is AgentType {
  return isValidProviderId(value);
}

export { getProviderDefinition, getAllProviderDefinitions };
export type { ProviderId, ProviderDefinition };
