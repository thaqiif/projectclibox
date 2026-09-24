/**
 * Functional test for DELETE /api/terminals/[name], hitting the route
 * handler directly with a stubbed `tmux` on PATH, so the delete flow's
 * guard pass, session kill, URL decoding and registry forget are all
 * driven end to end without depending on a real tmux server.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// All bind-at-import paths are isolated before the route module loads:
// DB_PATH wins over the home-derived default, and PATH puts the tmux stub
// first (buildCliwebEnvironment prepends the nanobrew/npm prefixes, so
// every prefix root is redirected into the sandbox too).
const SANDBOX = mkdtempSync(`${tmpdir()}/term-delete-test-`);
const BIN = join(SANDBOX, "bin");
const STUB_LOG = join(SANDBOX, "tmux-calls.log");
const OLD_PATH = process.env.PATH;
mkdirSync(BIN, { recursive: true });

process.env.DB_PATH = join(SANDBOX, "cliweb.db");
process.env.HOME = SANDBOX;
process.env.CLIWEB_NANOBREW_ROOT = join(SANDBOX, "nanobrew");
process.env.NPM_CONFIG_PREFIX = join(SANDBOX, "npm-prefix");
process.env.PATH = `${BIN}:${process.env.PATH}`;
process.env.TMUX_STUB_LOG = STUB_LOG;

// The stub records each invocation as a JSON line and exits 1 when the
// subcommand (second arg) is listed in TMUX_STUB_FAIL_JSON.
writeFileSync(
  join(BIN, "tmux"),
  `#!/usr/bin/env node
const fs = require("fs");
fs.appendFileSync(
  process.env.TMUX_STUB_LOG,
  JSON.stringify(process.argv.slice(2)) + "\\n"
);
const fail = (process.env.TMUX_STUB_FAIL_JSON || "").split(",");
if (fail.includes(process.argv[1])) process.exit(1);
process.exit(0);
`,
  { mode: 0o755 }
);

type RouteDeps = {
  deleteTerminal: typeof import("../app/api/terminals/[name]/route").DELETE;
  rememberTerminal: (typeof import("../lib/terminal-registry"))["rememberTerminal"];
  terminalRowExists: (typeof import("../lib/terminal-registry"))["terminalRowExists"];
};

let depsPromise: Promise<RouteDeps> | undefined;

function deps(): Promise<RouteDeps> {
  depsPromise ||= Promise.all([
    import("../app/api/terminals/[name]/route"),
    import("../lib/terminal-registry"),
  ]).then(([route, registry]) => ({
    deleteTerminal: route.DELETE,
    rememberTerminal: registry.rememberTerminal,
    terminalRowExists: registry.terminalRowExists,
  }));
  return depsPromise;
}

function stubCalls(): string[][] {
  return readFileSync(STUB_LOG, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function deleteRequest(name: string) {
  // Mirrors the client fetch: no Content-Type, no body — the shape the
  // guard bug turned into a 415.
  const encoded = encodeURIComponent(name);
  return {
    url: `http://localhost/api/terminals/${encoded}`,
    method: "DELETE",
    headers: new Headers({ origin: "http://localhost", host: "localhost" }),
    nextUrl: new URL(`http://localhost/api/terminals/${encoded}`),
    // Next's Node adapter can expose a stream even when the HTTP request had
    // no body. The DELETE route must therefore rely on the origin guard only.
    body: new ReadableStream(),
  } as unknown as import("next/server").NextRequest;
}

test.after(() => {
  delete process.env.DB_PATH;
  delete process.env.TMUX_STUB_LOG;
  delete process.env.TMUX_STUB_FAIL_JSON;
  delete process.env.CLIWEB_NANOBREW_ROOT;
  delete process.env.NPM_CONFIG_PREFIX;
  if (OLD_PATH) process.env.PATH = OLD_PATH;
  rmSync(SANDBOX, { recursive: true, force: true });
});

test("DELETE kills the tmux session and forgets the registry row", async () => {
  const { deleteTerminal, rememberTerminal, terminalRowExists } = await deps();
  rememberTerminal("term-abc123", "/tmp");

  const res = await deleteTerminal(deleteRequest("term-abc123"), {
    params: Promise.resolve({ name: "term-abc123" }),
  });

  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.success, true);
  assert.deepEqual(stubCalls(), [["kill-session", "-t", "term-abc123"]]);
  assert.equal(terminalRowExists("term-abc123"), false);
});

test("the route name is URL-decoded before it reaches tmux", async () => {
  const { deleteTerminal, rememberTerminal, terminalRowExists } = await deps();
  const name = "term-my session 1.1";
  rememberTerminal(name, "/tmp");

  const res = await deleteTerminal(deleteRequest(name), {
    // Next hands handlers the raw captured segment, decoded by the route.
    params: Promise.resolve({ name: encodeURIComponent(name) }),
  });

  assert.equal(res.status, 200);
  assert.ok(stubCalls().some((c) => c[2] === name));
  assert.equal(terminalRowExists(name), false);
});

test("a tmux kill failure still forgets the terminal and returns 200", async () => {
  const { deleteTerminal, rememberTerminal, terminalRowExists } = await deps();
  // A stopped terminal has no session for tmux to kill; forgetting is the
  // part that must happen either way.
  rememberTerminal("term-dead", "/tmp");
  process.env.TMUX_STUB_FAIL_JSON = "kill-session";

  const res = await deleteTerminal(deleteRequest("term-dead"), {
    params: Promise.resolve({ name: "term-dead" }),
  });

  assert.equal(res.status, 200);
  assert.equal(terminalRowExists("term-dead"), false);
  delete process.env.TMUX_STUB_FAIL_JSON;
});
