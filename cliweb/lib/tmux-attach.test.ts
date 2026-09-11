import assert from "node:assert/strict";
import test from "node:test";

import { tmuxAttachCommand } from "./tmux-attach";

/**
 * tmux starts a pane as a login shell, where bash reads /etc/profile — which
 * on Debian resets PATH to the system default — and then only the first of
 * ~/.bash_profile, ~/.bash_login and ~/.profile. ~/.bashrc is never read, so
 * anything installed under the persisted home (claude included) was missing
 * from PATH until the user sourced ~/.bashrc by hand.
 */
const INTERACTIVE_SHELL =
  "tmux set -g default-command 'exec \"${SHELL:-/bin/bash}\"'";

test("new tmux panes are started as interactive non-login shells", () => {
  const command = tmuxAttachCommand("work", "/workspaces/app");

  assert.ok(
    command.includes(INTERACTIVE_SHELL),
    `expected the shell to be pinned, got: ${command}`
  );
});

test("the shell is pinned before the attach that may start the server", () => {
  const command = tmuxAttachCommand("work", "/workspaces/app");

  // The options have to land before `tmux attach`, because attaching is what
  // starts a server that does not exist yet — and the window it opens is the
  // one that needs the shell.
  assert.ok(
    command.indexOf("default-command") < command.indexOf("tmux attach")
  );

  // The fallback creates the session from a *failed* attach, so the options
  // are repeated there rather than assumed.
  const afterFallback = command.slice(command.indexOf(" || { "));
  assert.ok(afterFallback.includes(INTERACTIVE_SHELL));
});

test("every option is quiet when there is no tmux server yet", () => {
  const command = tmuxAttachCommand("work", "/workspaces/app");
  const options = command.slice(0, command.indexOf("tmux attach"));
  const setCommands = options
    .split(";")
    .filter((part) => part.includes("tmux set"));

  assert.equal(setCommands.length, 3);
  for (const setCommand of setCommands) {
    assert.match(setCommand, /2>\/dev\/null$/);
  }
});

test("terminal names and working directories are quoted for the shell", () => {
  const command = tmuxAttachCommand("my name's terminal", "/workspaces/my app");

  // Unquoted, tmux reads `-t my name` as two arguments and then creates a new
  // terminal called `my`, which lands in the sidebar under Uncategorized.
  assert.ok(command.includes("-t 'my name'\\''s terminal'"));
  assert.ok(command.includes("-c '/workspaces/my app'"));
});

test("an unknown working directory attaches without inventing a terminal", () => {
  const command = tmuxAttachCommand("work", null);

  assert.ok(command.includes("tmux attach -t 'work'"));
  assert.ok(!command.includes("new-session"));
});
