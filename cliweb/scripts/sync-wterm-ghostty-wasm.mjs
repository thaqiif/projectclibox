import { createHash } from "node:crypto";
import { copyFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const metadata = JSON.parse(
  await readFile(resolve(root, "scripts/wterm-ghostty-build.json"), "utf8")
);
const packageJson = JSON.parse(
  await readFile(resolve(root, "node_modules/@wterm/ghostty/package.json"), "utf8")
);
if (packageJson.version !== metadata.wtermVersion) {
  throw new Error(
    `@wterm/ghostty ${packageJson.version} does not match pinned ${metadata.wtermVersion}`
  );
}

const source = resolve(root, "public/ghostty-vt.wasm");
const destination = resolve(root, "node_modules/@wterm/ghostty/wasm/ghostty-vt.wasm");
const bytes = await readFile(source);
const digest = createHash("sha256").update(bytes).digest("hex");
if (digest !== metadata.wasmSha256) {
  throw new Error(
    `Committed Ghostty WASM SHA-256 ${digest} does not match reviewed ${metadata.wasmSha256}`
  );
}
await copyFile(source, destination);
const installed = await readFile(destination);
const installedDigest = createHash("sha256").update(installed).digest("hex");
if (installedDigest !== metadata.wasmSha256) {
  throw new Error(
    `Installed Ghostty WASM SHA-256 ${installedDigest} does not match reviewed ${metadata.wasmSha256}`
  );
}
console.log(`Installed the reviewed Ghostty WASM artifact into @wterm/ghostty (${digest})`);
