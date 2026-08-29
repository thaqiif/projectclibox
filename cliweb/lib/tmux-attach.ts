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
  // Both are quiet when there is no server yet — the fallback repeats them.
  const options =
    "tmux set -g mouse on 2>/dev/null; tmux set -g status off 2>/dev/null";

  const attach = `${options}; tmux attach -t ${target}`;

  // No working directory means we do not know where this terminal lives —
  // the listing has not loaded, or the name does not match anything. Attach
  // and let it fail loudly. Guessing `$HOME` used to invent a terminal in
  // the wrong directory, which then showed up under Uncategorized.
  if (!cwd) return attach;

  const create = `tmux new-session -d -s ${target} -c ${quote(cwd)} 2>/dev/null`;

  return `${attach} 2>/dev/null || { ${create}; ${attach}; }`;
}
