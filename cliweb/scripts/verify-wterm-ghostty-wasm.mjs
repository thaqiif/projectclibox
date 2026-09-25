import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const metadata = JSON.parse(
  await readFile(resolve(root, "scripts/wterm-ghostty-build.json"), "utf8")
);
const packageJson = JSON.parse(
  await readFile(resolve(root, "node_modules/@wterm/ghostty/package.json"), "utf8")
);
const wasm = await readFile(resolve(root, "public/ghostty-vt.wasm"));
const digest = createHash("sha256").update(wasm).digest("hex");

if (packageJson.version !== metadata.wtermVersion) {
  throw new Error(
    `@wterm/ghostty ${packageJson.version} does not match pinned ${metadata.wtermVersion}`
  );
}
if (digest !== metadata.wasmSha256) {
  throw new Error(
    `public/ghostty-vt.wasm SHA-256 ${digest} does not match ${metadata.wasmSha256}`
  );
}

console.log(
  `Verified WTerm ${metadata.wtermVersion} (${metadata.wtermSourceCommit}), Ghostty ${metadata.ghosttyVersion}, WASM ${digest}`
);
