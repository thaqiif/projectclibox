/**
 * Terminal provider abstraction.
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

export interface TerminalProvider {
  id: ProviderId;
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

export const shellProvider: TerminalProvider = {
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

export const providers: Record<ProviderId, TerminalProvider> = {
  shell: shellProvider,
};

export function getProvider(_providerId: ProviderId): TerminalProvider {
  return shellProvider;
}

export function getAllProviders(): TerminalProvider[] {
  return [shellProvider];
}

export function isValidProvider(value: string): value is ProviderId {
  return isValidProviderId(value);
}

export { getProviderDefinition, getAllProviderDefinitions };
export type { ProviderId, ProviderDefinition };
