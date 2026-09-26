import assert from "node:assert/strict";
import test from "node:test";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildCliboxEnvironment,
  cliboxDataDir,
  cliboxProfileSuffix,
} from "./runtime-environment";
import { tmuxSessionEnvironmentArgs } from "./terminals";

test("builds one environment for persistent CLI installs", () => {
  const environment = buildCliboxEnvironment({
    HOME: "/home/clibox",
    NPM_CONFIG_PREFIX: "/home/clibox/.local",
    PATH: "/usr/local/bin:/usr/bin:/bin",
    CLIBOX_NANOBREW_ROOT: "/opt/nanobrew",
    CHROMIUM_PATH: "/usr/bin/chromium",
    SHELL: "/bin/bash",
  });

  assert.equal(
    environment.PATH,
    "/opt/nanobrew/prefix/bin:/home/clibox/.local/bin:/home/clibox/.local/sbin:/usr/local/bin:/usr/bin:/bin"
  );
  assert.equal(environment.NPM_CONFIG_PREFIX, "/home/clibox/.local");
  assert.equal(environment.NPM_CONFIG_USERCONFIG, "/home/clibox/.npmrc");
  assert.equal(environment.PYTHONUSERBASE, "/home/clibox/.local");
  assert.equal(environment.HOME, "/home/clibox");
  assert.equal(environment.CHROMIUM_PATH, "/usr/bin/chromium");
  assert.equal(environment.SHELL, "/bin/bash");
});

test("does not duplicate persistent paths already inherited by the server", () => {
  const environment = buildCliboxEnvironment({
    HOME: "/home/clibox",
    NPM_CONFIG_PREFIX: "/home/clibox/.local",
    PATH: "/opt/nanobrew/prefix/bin:/home/clibox/.local/bin:/bin",
    CLIBOX_NANOBREW_ROOT: "/opt/nanobrew",
  });

  assert.equal(
    environment.PATH,
    "/opt/nanobrew/prefix/bin:/home/clibox/.local/bin:/home/clibox/.local/sbin:/bin"
  );
});

test("passes the persistent environment into every new tmux session", () => {
  assert.deepEqual(
    tmuxSessionEnvironmentArgs({
      HOME: "/home/clibox",
      NPM_CONFIG_PREFIX: "/home/clibox/.local",
      PATH: "/usr/local/bin:/usr/bin:/bin",
      CLIBOX_NANOBREW_ROOT: "/opt/nanobrew",
      CHROMIUM_PATH: "/usr/bin/chromium",
      SHELL: "/bin/bash",
    }),
    [
      "-e",
      "PATH=/opt/nanobrew/prefix/bin:/home/clibox/.local/bin:/home/clibox/.local/sbin:/usr/local/bin:/usr/bin:/bin",
      "-e",
      "HOME=/home/clibox",
      "-e",
      "NPM_CONFIG_PREFIX=/home/clibox/.local",
      "-e",
      "NPM_CONFIG_USERCONFIG=/home/clibox/.npmrc",
      "-e",
      "PYTHONUSERBASE=/home/clibox/.local",
      "-e",
      "CLIBOX_NANOBREW_ROOT=/opt/nanobrew",
      "-e",
      "CHROMIUM_PATH=/usr/bin/chromium",
      "-e",
      "SHELL=/bin/bash",
      "-e",
      "USER=clibox",
      "-e",
      "LOGNAME=clibox",
    ]
  );
});

test("pre-rename CLIWEB_* settings still apply", () => {
  assert.equal(cliboxProfileSuffix({ CLIWEB_PROFILE: "Test" }), "-test");
  assert.equal(
    cliboxProfileSuffix({ CLIWEB_PROFILE: "old", CLIBOX_PROFILE: "new" }),
    "-new"
  );
  assert.match(
    buildCliboxEnvironment({ CLIWEB_NANOBREW_ROOT: "/nb" }).PATH ?? "",
    /^\/nb\/prefix\/bin:/
  );
});

test("the pre-rename data directory and database move into place", () => {
  const home = mkdtempSync(join(tmpdir(), "clibox-home-"));
  mkdirSync(join(home, ".cliweb-test"));
  writeFileSync(join(home, ".cliweb-test", "cliweb.db"), "db");
  writeFileSync(join(home, ".cliweb-test", "cliweb.db-wal"), "wal");

  const dir = cliboxDataDir({ HOME: home, CLIBOX_PROFILE: "test" });

  assert.equal(dir, join(home, ".clibox-test"));
  assert.equal(readFileSync(join(dir, "clibox.db"), "utf8"), "db");
  assert.equal(readFileSync(join(dir, "clibox.db-wal"), "utf8"), "wal");
  assert.equal(existsSync(join(home, ".cliweb-test")), false);
});

test("an existing data directory is never replaced by the legacy one", () => {
  const home = mkdtempSync(join(tmpdir(), "clibox-home-"));
  mkdirSync(join(home, ".clibox"));
  mkdirSync(join(home, ".cliweb"));

  assert.equal(cliboxDataDir({ HOME: home }), join(home, ".clibox"));
  assert.equal(existsSync(join(home, ".cliweb")), true);
});
