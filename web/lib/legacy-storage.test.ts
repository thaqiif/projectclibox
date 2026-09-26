import assert from "node:assert/strict";
import test from "node:test";
import { migrateLegacyStorage } from "./legacy-storage";

function memoryStorage(entries: Record<string, string>): Storage {
  const map = new Map(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => Array.from(map.keys())[index] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, value),
  };
}

test("legacy CLIWeb settings move to their CLIBox keys", () => {
  const storage = memoryStorage({
    "cliweb-sidebar-width": "320",
    "cliweb-sidebar-pinned": "false",
    "clibox:recentDirectories": '["/new"]',
    "cliweb:recentDirectories": '["/old"]',
  });

  migrateLegacyStorage(storage);

  assert.equal(storage.getItem("clibox-sidebar-width"), "320");
  assert.equal(storage.getItem("clibox-sidebar-pinned"), "false");
  // A value already saved under the new key wins.
  assert.equal(storage.getItem("clibox:recentDirectories"), '["/new"]');
  assert.equal(storage.getItem("cliweb-sidebar-width"), null);
  assert.equal(storage.getItem("cliweb:recentDirectories"), null);
});
