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
- File tree, editor, themes, font scaling, mobile keyboard controls, and PWA
  assets.
- A desktop monitor workspace for up to three terminals side by side. Dragging
  a terminal out of the sidebar opens it and gives the terminal somewhere to
  land.
- A non-root runtime user with host-matched `PUID`/`PGID`.
- Node/npm, Python/pip, git, SSH, tmux, ripgrep, jq, curl, build tools, and
  the Debian Chromium CLI at `/usr/bin/chromium`.

There are no preinstalled Claude, Codex, OpenCode, Command Code, harness
profiles, autopilot files, browser automation frameworks, Docker CLI, or Docker
socket. If you want Claude (or another CLI), install it manually inside a
terminal, for example:

```bash
npm install -g @anthropic-ai/claude-code
```

The UI always opens a plain shell and never auto-detects or launches installed
CLIs.

## Chromium CLI

The image installs Debian's Chromium package and its sandbox helper with
the fixed runtime path `/usr/bin/chromium`, then exports it as
`CHROMIUM_PATH`. Debian resolves Chromium's runtime libraries as package
dependencies, including the trixie `libglib2.0-0t64` transition package. The
container's web process runs as the unprivileged `cliweb` user. Use the same
user for ad-hoc commands instead of running Chromium as root:

```bash
# Confirm the image contains the expected Chromium binary and version.
docker compose exec --user cliweb cliweb sh -lc '"$CHROMIUM_PATH" --version'

# Render a page without a display and print its resulting HTML.
docker compose exec --user cliweb cliweb sh -lc '"$CHROMIUM_PATH" --headless=new --disable-dev-shm-usage --dump-dom https://example.com'
```

`--headless=new` is required in this display-less container. CLI tools
should point at `$CHROMIUM_PATH` (or the `chromium` command on `PATH`) rather
than downloading a second browser bundle.
`--disable-dev-shm-usage` is useful for pages that exceed Docker's default
shared-memory allocation. Keep the Chromium sandbox enabled: run it as the
unprivileged `cliweb` user and do not add `--no-sandbox`. Rebuild the image
after changing the Dockerfile:

```bash
docker compose up -d --build
```

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

## Hardware virtualization (KVM)

The container maps the host's `/dev/kvm` device through to the web terminals,
so you can run hardware-accelerated virtualization from a terminal—QEMU/KVM
guests, Android emulators, microVMs, or test suites that use KVM. Prerequisites
are on the **host**, not the container: your CPU must support virtualization
and the `kvm` module must be loaded.

```bash
ls -l /dev/kvm          # must exist; crw-rw---- root:kvm on most hosts
```

The entrypoint hands the device to the unprivileged `cliweb` user
automatically, so terminals can use it without extra setup:

```bash
ls -l /dev/kvm          # inside the container: crw-rw---- cliweb
```

> On hosts that do not export `/dev/kvm` (macOS/Windows Docker Desktop, or a
> VM without nested VT-x/AMD-V) the container will not start with this mapping.
> Remove the `/dev/kvm` line in `docker-compose.yml` for those hosts.

## Intel iGPU (VA-API/QSV ffmpeg transcode)

The container maps the host's `/dev/dri` through and installs
`ffmpeg` + `intel-media-va-driver` (iHD) + `libva` + `libvpl`, so web
terminals can use hardware transcode without `--privileged`:

```bash
ls -l /dev/dri                    # inside: card0 + renderD128, group cliweb
vainfo --display drm --device /dev/dri/renderD128
ffmpeg -hide_banner -hwaccels     # expect vaapi qsv drm
```

The entrypoint `chgrp cliweb` + `chmod 660` each DRI node after the
PUID/PGID remap, so the non-root `cliweb` user can open the GPU even when
host GIDs (`video:44`, `render:992`) differ from the container. `group_add`
is intentionally not used — the final `setpriv --init-groups` would drop it.

HD 620-class capability: H264 encode + H264/HEVC/VP9 decode. `hevc_qsv`,
`hevc_vaapi`, and VP9/AV1 encode are listed by ffmpeg but fail on this GPU;
use `h264_qsv` / `h264_vaapi`:

```bash
ffmpeg -hide_banner -init_hw_device vaapi=va:/dev/dri/renderD128 \
  -f lavfi -i testsrc=size=1280x720:rate=30:duration=5 \
  -vf 'format=nv12,hwupload' -c:v h264_vaapi -f null -
ffmpeg -hide_banner -init_hw_device qsv=qs:hw_any,child_device=/dev/dri/renderD128 \
  -f lavfi -i testsrc=size=1280x720:rate=30:duration=5 \
  -vf 'format=nv12,hwupload=extra_hw_frames=64' -c:v h264_qsv -f null -
```

> On hosts without `/dev/dri` remove the `/dev/dri` line in
> `docker-compose.yml`. The entrypoint guards each node, but Docker fails
> the deploy if the host path is missing. If headless Chromium crashes on
> DRI, rerun that job with `--disable-gpu`.

## Fresh database

The database uses one baseline migration in
`cliweb/lib/db/migrations.ts`. It creates the final workspace schema directly
and intentionally has no compatibility path for older CLIWeb volumes.

## Credits

The frontend and terminal experience are based on
[CLIWeb](https://github.com/saadnvd1/cliweb). This repository packages a
fresh, shell-only workspace variant for self-hosting.
