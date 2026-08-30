import assert from "node:assert/strict";
import test from "node:test";
import { isSupportedSettingKey } from "./settings";

test("only remaining appearance settings are accepted", () => {
  assert.equal(isSupportedSettingKey("fontScale"), true);
  assert.equal(isSupportedSettingKey("fontFamily"), true);
  assert.equal(isSupportedSettingKey("notifyTerminalCompletion"), false);
  assert.equal(isSupportedSettingKey("notifyKeepServerAlive"), false);
  assert.equal(isSupportedSettingKey("telegramBotToken"), false);
});
