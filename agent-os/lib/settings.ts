import type Database from "better-sqlite3";

const SUPPORTED_SETTING_KEYS = ["fontScale", "fontFamily"] as const;

const LEGACY_NOTIFICATION_SETTING_KEYS = [
  "notifyTerminalCompletion",
  "notifyKeepServerAlive",
  "telegramBotToken",
  "telegramChatId",
] as const;

export function isSupportedSettingKey(
  key: string
): key is (typeof SUPPORTED_SETTING_KEYS)[number] {
  return (SUPPORTED_SETTING_KEYS as readonly string[]).includes(key);
}

/** Remove settings belonging to the retired Telegram notification feature. */
export function removeLegacyNotificationSettings(db: Database.Database): void {
  const placeholders = LEGACY_NOTIFICATION_SETTING_KEYS.map(() => "?").join(
    ", "
  );
  db.prepare(`DELETE FROM settings WHERE key IN (${placeholders})`).run(
    ...LEGACY_NOTIFICATION_SETTING_KEYS
  );
}
