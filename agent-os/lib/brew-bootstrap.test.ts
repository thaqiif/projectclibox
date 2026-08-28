import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const bootstrapScript = join(
  process.cwd(),
  "..",
  "docker-brew-bootstrap.sh"
);

function writeBrewSource(root: string, marker: string) {
  mkdirSync(join(root, "Library", "Homebrew"), { recursive: true });
  mkdirSync(join(root, "bin"), { recursive: true });
  writeFileSync(join(root, "Library", "Homebrew", "brew.sh"), marker);
  writeFileSync(join(root, "bin", "brew"), "#!/usr/bin/env bash\nexit 0\n", {
    mode: 0o755,
  });
}

test("repairs the legacy nested Homebrew layout without removing Cellar data", () => {
  const fixture = mkdtempSync(join(tmpdir(), "cliweb-brew-"));
  const source = join(fixture, "source");
  const storage = join(fixture, "storage");

  try {
    writeBrewSource(source, "current-source");
    writeBrewSource(join(storage, "Homebrew"), "legacy-source");
    mkdirSync(join(storage, "bin"), { recursive: true });
    symlinkSync("../Homebrew/bin/brew", join(storage, "bin", "brew"));
    mkdirSync(join(storage, "Cellar", "gh", "1.0"), { recursive: true });
    writeFileSync(join(storage, "Cellar", "gh", "1.0", "installed"), "yes");

    const result = spawnSync("bash", [bootstrapScript], {
      encoding: "utf8",
      env: {
        ...process.env,
        CLIWEB_BREW_PREFIX: storage,
        CLIWEB_BREW_SOURCE: source,
      },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      readFileSync(join(storage, "Library", "Homebrew", "brew.sh"), "utf8"),
      "current-source"
    );
    assert.equal(lstatSync(join(storage, "bin", "brew")).isSymbolicLink(), false);
    assert.ok(existsSync(join(storage, "Cellar", "gh", "1.0", "installed")));
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
