import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const bootstrapScript = join(
  process.cwd(),
  "..",
  "docker-nanobrew-bootstrap.sh"
);

test("initializes nanobrew in its persistent data root", () => {
  const fixture = mkdtempSync(join(tmpdir(), "cliweb-nanobrew-"));
  const root = join(fixture, "nanobrew");
  const fakeNanobrew = join(fixture, "nb");
  const invocationLog = join(fixture, "invocation.log");

  try {
    writeFileSync(
      fakeNanobrew,
      '#!/usr/bin/env bash\nprintf "%s\\n" "$@" > "$CLIWEB_TEST_LOG"\nmkdir -p "$CLIWEB_NANOBREW_ROOT/prefix/bin"\n',
      { mode: 0o755 }
    );

    const result = spawnSync("bash", [bootstrapScript], {
      encoding: "utf8",
      env: {
        ...process.env,
        CLIWEB_NANOBREW_ROOT: root,
        CLIWEB_NANOBREW_BIN: fakeNanobrew,
        CLIWEB_TEST_LOG: invocationLog,
      },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(invocationLog, "utf8"), "init\n");
    assert.ok(existsSync(root));
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
