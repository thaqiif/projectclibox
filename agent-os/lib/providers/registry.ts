/**
 * Provider registry for the workspace shell.
 *
 * This build intentionally has no bundled AI harnesses. Users can install any
 * CLI they want from the terminal; AgentOS always opens a plain shell and does
 * not attempt to discover or launch those CLIs for them.
 */

export const PROVIDER_IDS = ["shell"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface ProviderDefinition {
  id: ProviderId;
  name: string;
  description: string;
  cli: string;
  configDir: string;
  supportsResume: boolean;
  supportsFork: boolean;
}

export const SHELL_PROVIDER: ProviderDefinition = {
  id: "shell",
  name: "Terminal",
  description: "Plain shell terminal",
  cli: "",
  configDir: "",
  supportsResume: false,
  supportsFork: false,
};

export const PROVIDERS: ProviderDefinition[] = [SHELL_PROVIDER];
export const PROVIDER_MAP = new Map<ProviderId, ProviderDefinition>(
  PROVIDERS.map((provider) => [provider.id, provider])
);

export function getProviderDefinition(id: ProviderId): ProviderDefinition {
  return PROVIDER_MAP.get(id) ?? SHELL_PROVIDER;
}

export function getAllProviderDefinitions(): ProviderDefinition[] {
  return PROVIDERS;
}

export function isValidProviderId(value: string): value is ProviderId {
  return value === "shell";
}

// Retained for callers that use the upstream helper. This build has no
// managed terminal naming convention.
export function getManagedTerminalPattern(): RegExp {
  return /(?!)/;
}

export function getProviderIdFromTerminalName(
  _terminalName: string
): ProviderId | null {
  return null;
}

export function getTerminalIdFromName(terminalName: string): string {
  return terminalName;
}
