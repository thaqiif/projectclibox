# CLIWeb Workspace

A small, self-hosted browser workspace built from the CLIWeb UI. It gives you
projects, a persistent web terminal, file browsing/editing, themes, font-scale
controls, and PWA support—without bundling an AI coding CLI or exposing the
host Docker daemon.

## Start

```bash
cp .env.example .env
docker compose up -d --build
```

Open <http://localhost:3011> (or the configured `HOST_PORT`). The default bind
address is localhost-only. Set `HOST_BIND=0.0.0.0` when you intentionally want
to reach the UI from another device on your LAN, and protect it with a firewall
or reverse proxy.

This UI can execute shell commands and read/write the mounted workspace. Do not
publish it to an untrusted network without adding authentication and network
controls.

## What is included

- A project list whose projects are folders under `/workspaces` (or another
  host directory selected with `WORKSPACE_DIR`). Use the container path
  `/workspaces/<project>` in the project dialog.
- Browser terminals backed by tmux, with terminal metadata stored in SQLite.
- File tree, editor, code search, themes, font scaling, mobile
  keyboard controls, and PWA assets.
- A non-root runtime user with host-matched `PUID`/`PGID`.
- Node/npm, Python/pip, git, SSH, tmux, ripgrep, jq, curl, and build tools.

There are no preinstalled Claude, Codex, OpenCode, Command Code, harness
profiles, autopilot files, browser bundle, Docker CLI, or Docker socket. If you
want Claude (or another CLI), install it manually inside a terminal, for
example:

```bash
npm install -g @anthropic-ai/claude-code
```

The UI always opens a plain shell and never auto-detects or launches installed
CLIs.

## Persistence

The host directory `/home/cliweb` is bind-mounted at the same path in the
container. It stores the SQLite database, shell configuration, Git
identity/credentials, npm global packages, pip user packages, Homebrew, and
other user-local tools. These survive container restarts, redeployments, and
image rebuilds as long as `/home/cliweb` is backed by persistent host storage.

`npm -g` is configured to install under `/home/cliweb/.local`, so it works as a
non-root user and persists. Use `pip install --user ...` for Python packages.
System-level `apt` installs are intentionally unavailable to the non-root
terminal and are not part of the persistence contract; add them to the
Dockerfile if a project truly needs them.

Project files live in the host bind mount configured by `WORKSPACE_DIR`, so they
remain available independently of the container lifecycle.

The terminal registry survives restarts, but running processes do not: Docker
stopping a container stops its tmux server. Stopped terminals reappear in the
sidebar and can be reopened in their previous folder.

## Configuration

See [.env.example](.env.example) for the small set of supported settings:

- `WORKSPACE_DIR` — host folder mounted as `/workspaces`.
- `HOST_PORT` / `HOST_BIND` — web UI port and bind address.
- `PUID` / `PGID` — host ownership for `/home/cliweb` and workspace files.
- Any additional variables in `.env` are passed through to terminal shells,
  which is useful for API keys or project-specific configuration.

To remove all saved state, run `docker compose down -v`. This deletes the
named home volume; host project files are not deleted.

## Fresh database

The database uses one baseline migration in
`cliweb/lib/db/migrations.ts`. It creates the final workspace schema directly
and intentionally has no compatibility path for older CLIWeb volumes.

## Credits

The frontend and terminal experience are based on
[CLIWeb](https://github.com/saadnvd1/cliweb). This repository packages a
fresh, shell-only workspace variant for self-hosting.
