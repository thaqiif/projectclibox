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

## Test deployment

`docker-compose.test.yml` runs a second, fully isolated copy alongside
production (handy when the production app and a test app are deployed from
the same repo, e.g. two Coolify applications). Differences from production:

- Persisted home: `/home/cliweb-test` on the host (production uses
  `/home/cliweb`), so settings, database, trash, and installed tools are
  completely separate.
- Workspaces: `./workspaces-test` (override with `TEST_WORKSPACE_DIR`), so
  project folders are separate too.
- Host port: `3012` (override with `TEST_HOST_PORT`, bind with
  `TEST_HOST_BIND`); production stays on `3011`. The `TEST_` prefix means a
  `.env` that sets `HOST_PORT=3011` for production cannot make the test
  stack collide with it.
- `CLIWEB_PROFILE=test`, so app state lives under `~/.cliweb-test/` inside
  its own home (redundant with the separate home, but harmless).

No environment variables are required: test-specific defaults and `TEST_`
override names keep a shared production `.env` from redirecting these mounts
or ports. Point the second Coolify application at this compose file and deploy.
The startup ownership guard (`.deployment-owner`) is still satisfied even if
production and test use different PUID/PGID values: each deployment writes the
marker under its own host home and chowns only that home.

## Configuration

See [.env.example](.env.example) for the small set of supported settings:

- `WORKSPACE_DIR` — host folder mounted as `/workspaces`.
- `HOST_PORT` / `HOST_BIND` — web UI port and bind address.
- `PUID` / `PGID` — host ownership for `/home/cliweb` and workspace files.
- `CLIWEB_PROFILE` — optional data-namespace suffix. Set it to a different
  value per deployment (for example `test`) when two deployments share the
  persisted home mount: all state (database, trash) goes under
  `~/.cliweb-<profile>/` instead of `~/.cliweb/`, so they coexist without
  sharing data. Explicit `DB_PATH` still takes precedence if you need full
  manual control.
  Two deployments sharing the persisted home mount MUST also set identical
  `PUID`/`PGID`: container startup marks the home with its ownership and
  refuses to start with different ids (a mismatched restart would chown the
  shared tree and steal ownership from the other, running, deployment).
- Any additional variables in `.env` are passed through to terminal shells,
  which is useful for API keys or project-specific configuration.

`docker compose down -v` does not remove the persistent host bind mounts
(`/home/cliweb`, the workspace, or nanobrew); this Compose file
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
via `CREATE TABLE IF NOT EXISTS` plus `INSERT OR IGNORE`, so it is idempotent
and safe against databases created by earlier images: a volume that already
has the old (32b74ba-era) `projects` schema keeps its extra columns, which the
current `SELECT *` queries tolerate, and the data stays intact. This was
verified by replaying the current migrations against each historical production
schema/tracker combination (migration rows `{1}`, `{1,2}`, `{1,3}`, `{1,2,3}`,
and an empty `_migrations` table), in all cases with assertions for successful
queries and unchanged pre-existing row data.

## Production migration checklist (develop -> master deploy)

Pre-deploy checks and steps for merging develop into master and letting
Coolify rebuild production. Read end to end before deploying.

### 1. Back up first (rollback anchor)

```sh
# On the Docker host, before deploying. SQLite's online backup includes data
# that may still be in the live database's WAL file.
sqlite3 /home/cliweb/.cliweb/cliweb.db \
  ".backup '/home/cliweb/.cliweb/cliweb.db.bak'"
sqlite3 /home/cliweb/.cliweb/cliweb.db.bak "PRAGMA integrity_check"
```

Rollback procedure: revert the Coolify application to the previous deploy
(the previous image is kept), or redeploy the pre-merge master revision. The
current migration is schema-compatible with the old image, so an image-only
rollback can keep the live database. To restore the exact pre-deploy data,
stop the application first, replace `cliweb.db` with `cliweb.db.bak`, remove
stale `cliweb.db-wal` and `cliweb.db-shm` files, then start the old image.

### 2. Data and layout compatibility (verified)

- Default DB path: new code resolves `HOME/.cliweb/cliweb.db`; with prod
  `HOME=/home/cliweb` this is exactly `/home/cliweb/.cliweb/cliweb.db` — the
  same file prod already uses. `DB_PATH` also remains explicitly supported
  if it is set anywhere.
- First boot with the existing prod DB does not rewrite it: the baseline
  migration is skipped (already applied) and all queries are verified against
  the old schema (see "Fresh database" above).
- No destructive `ALTER` / `NOT NULL DEFAULT` hazards exist in the current
  migration set.

### 3. Environment contract (no action needed)

- `DB_PATH` was removed from the image's Dockerfile `ENV`, but the default
  matches the old setting byte-for-byte, and an explicitly set `DB_PATH`
  still wins over the default.
- `CLIWEB_PROFILE` is optional; production sets nothing and keeps the
  `~/.cliweb/` paths unchanged.
- The `.deployment-owner` ownership guard resolves against the production
  home (`/home/cliweb/.cliweb/.deployment-owner`) and simply re-records
  prod's `PUID:PGID` on first boot. The test deployment lives under
  `/home/cliweb-test` (see "Test deployment"), so it can never write a
  conflicting marker into prod's home.

### 4. HTTP same-origin guard behind the proxy

New API routes enforce an Origin-vs-Host check on mutating requests. Browsers
always send `Origin` on POST, and it usually matches the proxied `Host`, so
same-origin UI traffic passes. Two residual risks and their handling:

- Proxies that rewrite `Host` (Coolify generally forwards it, but other
  front-ends or TLS terminators may not): the guard now also honors the
  `X-Forwarded-Host` header the proxy should send as a fallback comparison.
  If a request is still rejected with `403 "Origin does not match Host"`,
  first check that the proxy sends `X-Forwarded-Host` with the public domain;
  if the proxy strips both `Host` and `X-Forwarded-Host`, add proxy
  forwarding (e.g. proxy_set_header Host $host plus X-Forwarded-Host in the
  reverse proxy config) or temporarily roll back by pinning the previous
  image.
- The fallback assumes the trusted edge overwrites inbound forwarding
  headers. A raw HTTP client can make `Origin` and `X-Forwarded-Host` agree,
  but it has no browser-managed ambient credentials and therefore cannot use
  that fact for CSRF. Browser cross-origin requests cannot add this non-
  safelisted header without a successful CORS preflight. Do not expose the
  origin server directly to browsers around that trusted edge.
- Absence of `Origin` passes (curl/CLI clients unaffected).

### 5. Post-deploy smoke test

After Coolify redeploys, verify before declaring success:

- Container starts; logs show no `This persisted home is owned by ...` guard
  error and no migration traceback.
- `GET /api/projects` and the UI load; create a terminal (POST path through
  the origin guard, proving the proxy/host contract works).
- `sqlite3 /home/cliweb/.cliweb/cliweb.db "SELECT count(*) FROM projects"`
  unchanged.

If item 4 fails with 403s or item 2 shows an unexpected migration error,
rollback per section 1 and investigate; the image-to-image rollback is safe
because the migration set is forward-only and skipped when already applied.

## Credits

The frontend and terminal experience are based on
[CLIWeb](https://github.com/saadnvd1/cliweb). This repository packages a
fresh, shell-only workspace variant for self-hosting.
