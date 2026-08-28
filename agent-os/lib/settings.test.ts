import assert from "node:assert/strict";
import test from "node:test";
import {
  isSupportedSettingKey,
  removeLegacyNotificationSettings,
} from "./settings";

test("only remaining appearance settings are accepted", () => {
  assert.equal(isSupportedSettingKey("fontScale"), true);
  assert.equal(isSupportedSettingKey("fontFamily"), true);
  assert.equal(isSupportedSettingKey("notifyTerminalCompletion"), false);
  assert.equal(isSupportedSettingKey("notifyKeepServerAlive"), false);
  assert.equal(isSupportedSettingKey("telegramBotToken"), false);
});

test("removes legacy notification settings from existing databases", () => {
  let deletedKeys: string[] = [];
  const db = {
    prepare(sql: string) {
      assert.match(sql, /DELETE FROM settings WHERE key IN \(\?, \?, \?, \?\)/);
      return {
        run(...keys: unknown[]) {
          deletedKeys = keys as string[];
        },
      };
    },
  } as unknown as Parameters<typeof removeLegacyNotificationSettings>[0];

  removeLegacyNotificationSettings(db);

  assert.deepEqual(deletedKeys, [
    "notifyTerminalCompletion",
    "notifyKeepServerAlive",
    "telegramBotToken",
    "telegramChatId",
  ]);
});
