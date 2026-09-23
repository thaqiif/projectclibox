# CLIWeb Workspace

A small, self-hosted browser workspace built from the CLIWeb UI. It gives you
projects, a persistent web terminal, file browsing/editing, themes, font-scale
controls, and PWA support—without bundling an AI coding CLI or exposing the
host Docker daemon.

## Start

```bash
cp .env.example .env

# Required by the kernel-TUN Tailscale sidecar on the Docker host.
sudo modprobe tun
sudo install -d -o root -g root -m 0700 /var/lib/cliweb-tailscale
sudo chown root:root /var/lib/cliweb-tailscale
sudo chmod 0700 /var/lib/cliweb-tailscale

docker compose up -d --build
```

Open <http://localhost:3011> (or the configured `HOST_PORT`). The default bind
address is localhost-only. Set `HOST_BIND=0.0.0.0` when you intentionally want
to reach the UI from another device on your LAN, and protect it with a firewall
or reverse proxy. The Tailscale sidecar setup and its `/dev/net/tun` host
prerequisite are described below.

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

### GPU acceleration (AMD)

The image drops `/etc/chromium.d/amd-gpu`, which Debian's Chromium launcher
sources before every exec. It appends `--use-angle=vulkan
--enable-features=Vulkan` so WebGL/compositing runs on the AMD GPU (RADV)
instead of falling back to SwiftShader (CPU). Verify:

```bash
# Should report RADV PHOENIX, not SwiftShader.
docker compose exec --user cliweb cliweb sh -lc '
  tmp=$(mktemp -d)
  cat > "$tmp/p.html" <<HTML
<html><body><script>
const c=document.createElement("canvas");
const g=c.getContext("webgl2")||c.getContext("webgl");
const d=g&&g.getExtension("WEBGL_debug_renderer_info");
document.title=g?(d?g.getParameter(d.UNMASKED_RENDERER_WEBGL):g.getParameter(g.RENDERER)):"NO_WEBGL";
</script></body></html>
HTML
  "$CHROMIUM_PATH" --headless=new --no-sandbox --disable-dev-shm-usage \
    --virtual-time-budget=5000 --dump-dom "file://$tmp/p.html" \
    | grep -o "<title>[^<]*</title>"
  rm -rf "$tmp"
'
```

On hosts without a Vulkan device the flags are harmless — Chromium degrades
to SwiftShader, matching stock behaviour.

## Tailscale sidecar

Compose runs a pinned Tailscale daemon in a sidecar that shares CLIWeb's
network namespace. The sidecar uses kernel TUN mode, so the **Docker host**
must provide `/dev/net/tun` before the stack starts:

```bash
# Linux hosts may need the module loaded first.
sudo modprobe tun
ls -l /dev/net/tun   # must be a character device

# Tailscale stores node identity and credentials here; keep it root-only.
sudo install -d -o root -g root -m 0700 /var/lib/cliweb-tailscale
sudo chown root:root /var/lib/cliweb-tailscale
sudo chmod 0700 /var/lib/cliweb-tailscale

docker compose up -d --build
```

The first authentication is interactive. Run this command and follow the
login URL it prints (or the browser flow it opens):

```bash
docker compose exec -it tailscale tailscale --socket=/tmp/tailscaled.sock up --accept-dns=false
```

Check the node and its addresses with:

```bash
docker compose exec tailscale tailscale --socket=/tmp/tailscaled.sock status
docker compose exec tailscale tailscale --socket=/tmp/tailscaled.sock ip
```

CLIWeb remains available locally at
`http://localhost:3011`. After the node is authorized, a permitted tailnet
client can use the Tailscale IPv4 address from `tailscale ip`, for example
`http://100.x.y.z:3011`; no separate sidecar port mapping is needed because
the two services share a network namespace. The normal CLIWeb host port
continues to be owned by the `cliweb` service.

The node identity and login state are persisted in the host bind mount
`/var/lib/cliweb-tailscale`, so restarts, image rebuilds, and
`docker compose down` followed by `docker compose up` do not require logging
in again. This is a bind mount, not a Docker-managed volume:
`docker compose down -v` does **not** delete the Tailscale state, the
`/home/cliweb` home, or workspace bind mounts, and this Compose file defines no
named volumes. Remove those host directories manually only when you deliberately
want to discard their state.

Tailnet reachability is not application authentication. CLIWeb exposes a shell
and mounted files to any client that can reach port 3011, so review your
Tailscale ACLs/grants, device access, and tags before authorizing users. Keep
the default localhost bind unless LAN access is intentional, and add an
application authentication layer or reverse proxy if the tailnet includes
untrusted users. Never place `TS_AUTHKEY` in the root `.env`: Compose passes
that file's values into CLIWeb terminal environments. Use the interactive
`tailscale up` flow instead, or handle a short-lived secret outside the root
terminal environment.

This setup deliberately uses kernel TUN (`--tun=tailscale0`) because it gives
the shared namespace a normal Tailscale interface and makes direct access to
CLIWeb's port straightforward. It requires `/dev/net/tun` plus `NET_ADMIN`
and `NET_RAW`. Tailscale's userspace mode
(`--tun=userspace-networking`) can avoid the kernel TUN device and associated
interface permissions, which is useful on restricted hosts, but it does not
create a normal `tailscale0` interface; applications then need the userspace
SOCKS5/HTTP proxy or another Tailscale application-level feature, so the direct
tailnet-to-port setup documented here no longer applies unchanged.

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

`docker compose down -v` does not remove the persistent host bind mounts
(`/home/cliweb`, the workspace, nanobrew, or Tailscale state); this Compose file
has no named volumes. Stop the stack and remove the relevant host directories
manually only when you intentionally want to discard saved state.

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

## GPU support (Intel + AMD amdgpu)

The container maps the host's `/dev/dri` (video/render nodes) and, on AMD
hosts, `/dev/kfd` (ROCm/OpenCL compute) through, and installs `ffmpeg` +
Mesa userspace (`mesa-va-drivers`, `mesa-vdpau-drivers`,
`mesa-vulkan-drivers`, `mesa-opencl-icd`) alongside the Intel `iHD` driver,
so web terminals can use hardware accel without `--privileged`:

```bash
ls -l /dev/dri /dev/kfd           # inside: card*, renderD*, kfd — group cliweb
vainfo --display drm --device /dev/dri/renderD128
vainfo --display drm --device /dev/dri/renderD129   # second GPU, if present
vulkaninfo --summary               # RADV on AMD, Intel Vulkan elsewhere
clinfo --short                     # Mesa OpenCL (Rusticl/Clover)
ffmpeg -hide_banner -hwaccels     # expect vaapi qsv drm vulkan opencl
radeontop                          # AMD utilization monitor
```

The entrypoint `chgrp cliweb` + `chmod 660` every DRI node
(`/dev/dri/card*`, `/dev/dri/renderD*`) and `/dev/kfd` after the PUID/PGID
remap, so the non-root `cliweb` user can open all GPUs even when host GIDs
(`video:44`, `render:992`) differ from the container. `group_add` is
intentionally not used — the final `setpriv --init-groups` would drop it.

AMD notes:

- VA-API uses the `radeonsi` driver (`radeonsi_drv_video.so`). Pick the
  render node that belongs to the AMD card and test encode, e.g.:
  ```bash
  ffmpeg -hide_banner -init_hw_device vaapi=va:/dev/dri/renderD129 \
    -f lavfi -i testsrc=size=1280x720:rate=30:duration=5 \
    -vf 'format=nv12,hwupload' -c:v h264_vaapi -f null -
  ```
- `/dev/kfd` is required for ROCm/OpenCL compute (PyTorch ROCm, Ollama
  ROCm, `clinfo`). The image ships the Mesa OpenCL ICD only; the full
  ROCm stack is intentionally not baked in — install it user-locally or
  use a ROCm-enabled tool when you need HIP/rocBLAS.
- On multi-GPU hosts (e.g. `virtio-gpu` + `amdgpu`) each GPU gets its own
  `cardX`/`renderDX` pair; check `vainfo` per render node to find the AMD
  one.

Intel notes (unchanged): HD 620-class capability is H264 encode +
H264/HEVC/VP9 decode; use `h264_qsv` / `h264_vaapi` (`hevc_qsv`,
`hevc_vaapi`, VP9/AV1 encode list but fail on that GPU).

> On hosts without `/dev/dri` remove the `/dev/dri` line in
> `docker-compose.yml`; on hosts without an AMD GPU remove the `/dev/kfd`
> line. The entrypoint guards each node, but Docker fails the deploy if a
> mapped host path is missing. If headless Chromium crashes on DRI, rerun
> that job with `--disable-gpu`.

## Fresh database

The database uses one baseline migration in
`cliweb/lib/db/migrations.ts`. It creates the final workspace schema directly
and intentionally has no compatibility path for older CLIWeb volumes.

## Credits

The frontend and terminal experience are based on
[CLIWeb](https://github.com/saadnvd1/cliweb). This repository packages a
fresh, shell-only workspace variant for self-hosting.
