/**
 * Single-quote a value for the shell.
 *
 * Terminal names are user-chosen and working directories are arbitrary
 * paths, so both can contain spaces — an unquoted `tmux attach -t my name`
 * is parsed as two arguments and fails with "too many arguments", after
 * which the fallback happily creates a *new* terminal called `my`.
 */
function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * The shell every new tmux pane is started as.
 *
 * tmux starts a pane as a *login* shell, and bash reads a login shell's
 * startup files in a different order: /etc/profile first — which on Debian
 * resets PATH to the system default, dropping the persisted package
 * directories — then only the first of ~/.bash_profile, ~/.bash_login and
 * ~/.profile. ~/.bashrc is never read.
 *
 * So a fresh pane came up with the system PATH and no ~/.local/bin: claude,
 * and anything else installed into the persisted home, reported "command not
 * found" until the user sourced ~/.bashrc by hand. Naming the shell here makes
 * it a non-login *interactive* shell, which reads ~/.bashrc — where the
 * persistent package paths and the user's own aliases already live. That is
 * what the browser terminals are expected to be, and what every other web
 * terminal does. ${SHELL} keeps a user-chosen default-shell working; the
 * fallback covers a server started without one.
 */
const INTERACTIVE_SHELL = `exec "\${SHELL:-/bin/bash}"`;

/**
 * The command the workbench types into its shell to attach to a terminal.
 *
 * The pty behind the terminal is a plain shell, so "attaching" is literally
 * running `tmux attach` in it. Two callers need the exact same string — the
 * sidebar click and the terminal's own connect handler — so it lives here.
 *
 * A terminal whose tmux process has been killed is still listed, hence the
 * fallback: if the attach fails the terminal is created again in the same
 * working directory. That also closes the race where a terminal dies between
 * the listing and the click.
 */
export function tmuxAttachCommand(name: string, cwd?: string | null): string {
  const target = quote(name);

  // `-g` writes the server's global options, so this covers whatever the
  // attach lands on, including a server these commands just started. Mouse
  // mode makes tmux's own splits usable in the browser; the status bar is
  // redundant here, since the workbench already says which terminal this is.
  // The shell is pinned for the reason on INTERACTIVE_SHELL above. All of them
  // are quiet when there is no server yet — the fallback repeats them.
  const options =
    "tmux set -g mouse on 2>/dev/null; " +
    "tmux set -g status off 2>/dev/null; " +
    // tmux scrolls copy mode five lines per wheel event by default, which
    // makes touch and trackpad scrolling jump in blocks. One line per event
    // lets the browser's fine-grained wheel reports move the view smoothly.
    "tmux bind -T copy-mode WheelUpPane send -N1 -X scroll-up 2>/dev/null; " +
    "tmux bind -T copy-mode WheelDownPane send -N1 -X scroll-down 2>/dev/null; " +
    "tmux bind -T copy-mode-vi WheelUpPane send -N1 -X scroll-up 2>/dev/null; " +
    "tmux bind -T copy-mode-vi WheelDownPane send -N1 -X scroll-down 2>/dev/null; " +
    `tmux set -g default-command '${INTERACTIVE_SHELL}' 2>/dev/null`;

  const attach = `${options}; tmux attach -t ${target}`;

  // No working directory means we do not know where this terminal lives —
  // the listing has not loaded, or the name does not match anything. Attach
  // and let it fail loudly. Guessing `$HOME` used to invent a terminal in
  // the wrong directory, which then showed up under Uncategorized.
  if (!cwd) return attach;

  const create = `tmux new-session -d -s ${target} -c ${quote(cwd)} 2>/dev/null`;

  return `${attach} 2>/dev/null || { ${create}; ${attach}; }`;
}
