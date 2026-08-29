import type { ProviderId } from "./providers";

export interface ModelOption {
  value: string;
  label: string;
}

// Models belong to installed CLIs, not to this shell-only workspace UI.
export function getModelOptions(_providerId: ProviderId): ModelOption[] {
  return [];
}

export function getDefaultModelForProvider(_providerId: ProviderId): string {
  return "";
}

export function isSupportedModelForProvider(
  _providerId: ProviderId,
  _model: string | null | undefined
): boolean {
  return false;
}

export function resolveModelForProvider(
  _providerId: ProviderId,
  _model: string | null | undefined
): string {
  return "";
}
