import assert from "node:assert/strict";
import test from "node:test";
import { buildCliwebEnvironment } from "./runtime-environment";
import { tmuxSessionEnvironmentArgs } from "./terminals";

test("builds one environment for persistent CLI installs", () => {
  const environment = buildCliwebEnvironment({
    HOME: "/home/cliweb",
    NPM_CONFIG_PREFIX: "/home/cliweb/.local",
    PATH: "/usr/local/bin:/usr/bin:/bin",
    CLIWEB_NANOBREW_ROOT: "/opt/nanobrew",
    SHELL: "/bin/bash",
  });

  assert.equal(
    environment.PATH,
    "/opt/nanobrew/prefix/bin:/home/cliweb/.local/bin:/home/cliweb/.local/sbin:/usr/local/bin:/usr/bin:/bin"
  );
  assert.equal(environment.NPM_CONFIG_PREFIX, "/home/cliweb/.local");
  assert.equal(environment.NPM_CONFIG_USERCONFIG, "/home/cliweb/.npmrc");
  assert.equal(environment.PYTHONUSERBASE, "/home/cliweb/.local");
  assert.equal(environment.HOME, "/home/cliweb");
  assert.equal(environment.SHELL, "/bin/bash");
});

test("does not duplicate persistent paths already inherited by the server", () => {
  const environment = buildCliwebEnvironment({
    HOME: "/home/cliweb",
    NPM_CONFIG_PREFIX: "/home/cliweb/.local",
    PATH: "/opt/nanobrew/prefix/bin:/home/cliweb/.local/bin:/bin",
    CLIWEB_NANOBREW_ROOT: "/opt/nanobrew",
  });

  assert.equal(
    environment.PATH,
    "/opt/nanobrew/prefix/bin:/home/cliweb/.local/bin:/home/cliweb/.local/sbin:/bin"
  );
});

test("passes the persistent environment into every new tmux session", () => {
  assert.deepEqual(
    tmuxSessionEnvironmentArgs({
      HOME: "/home/cliweb",
      NPM_CONFIG_PREFIX: "/home/cliweb/.local",
      PATH: "/usr/local/bin:/usr/bin:/bin",
      CLIWEB_NANOBREW_ROOT: "/opt/nanobrew",
      SHELL: "/bin/bash",
    }),
    [
      "-e",
      "PATH=/opt/nanobrew/prefix/bin:/home/cliweb/.local/bin:/home/cliweb/.local/sbin:/usr/local/bin:/usr/bin:/bin",
      "-e",
      "HOME=/home/cliweb",
      "-e",
      "NPM_CONFIG_PREFIX=/home/cliweb/.local",
      "-e",
      "NPM_CONFIG_USERCONFIG=/home/cliweb/.npmrc",
      "-e",
      "PYTHONUSERBASE=/home/cliweb/.local",
      "-e",
      "CLIWEB_NANOBREW_ROOT=/opt/nanobrew",
      "-e",
      "SHELL=/bin/bash",
      "-e",
      "USER=cliweb",
      "-e",
      "LOGNAME=cliweb",
    ]
  );
});
