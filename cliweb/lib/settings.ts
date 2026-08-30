const SUPPORTED_SETTING_KEYS = ["fontScale", "fontFamily"] as const;

export function isSupportedSettingKey(
  key: string
): key is (typeof SUPPORTED_SETTING_KEYS)[number] {
  return (SUPPORTED_SETTING_KEYS as readonly string[]).includes(key);
}
