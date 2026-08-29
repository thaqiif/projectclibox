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
const brewCommandScript = join(
  process.cwd(),
  "..",
  "docker-brew-command.sh"
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
  const legacy = join(fixture, "legacy-home", "brew");

  try {
    writeBrewSource(source, "current-source");
    writeBrewSource(join(legacy, "Homebrew"), "legacy-source");
    mkdirSync(join(legacy, "bin"), { recursive: true });
    symlinkSync("../Homebrew/bin/brew", join(legacy, "bin", "brew"));
    mkdirSync(join(legacy, "Cellar", "gh", "1.0"), { recursive: true });
    writeFileSync(join(legacy, "Cellar", "gh", "1.0", "installed"), "yes");

    const result = spawnSync("bash", [bootstrapScript], {
      encoding: "utf8",
      env: {
        ...process.env,
        CLIWEB_BREW_PREFIX: storage,
        CLIWEB_BREW_SOURCE: source,
        CLIWEB_BREW_LEGACY: legacy,
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

test("launches Brew through the supported prefix instead of /usr/local", () => {
  const fixture = mkdtempSync(join(tmpdir(), "cliweb-brew-command-"));
  const prefix = join(fixture, "prefix");

  try {
    mkdirSync(join(prefix, "bin"), { recursive: true });
    writeFileSync(
      join(prefix, "bin", "brew"),
      '#!/usr/bin/env bash\nprintf "%s\\n" "$0"\n',
      { mode: 0o755 }
    );

    const result = spawnSync("bash", [brewCommandScript], {
      encoding: "utf8",
      env: { ...process.env, HOMEBREW_PREFIX: prefix },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), join(prefix, "bin", "brew"));
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
