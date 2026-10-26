/**
 * Browser settings saved before the CLIWeb → CLIBox rename, keyed by their
 * old names. Each is copied to its new key once, when the new key is unset.
 */
const RENAMED_KEYS: Array<[legacy: string, current: string]> = [
  ["cliweb-sidebar-width", "clibox-sidebar-width"],
  ["cliweb-sidebar-pinned", "clibox-sidebar-pinned"],
  ["cliweb:recentDirectories", "clibox:recentDirectories"],
];

export function migrateLegacyStorage(storage: Storage): void {
  for (const [legacy, current] of RENAMED_KEYS) {
    const value = storage.getItem(legacy);
    if (value === null) continue;
    if (storage.getItem(current) === null) storage.setItem(current, value);
    storage.removeItem(legacy);
  }
}
