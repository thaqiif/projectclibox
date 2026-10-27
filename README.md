<p align="center">
  <img src="web/public/branding/clibox-terminal.svg" width="96" height="96" alt="CLIBox logo">
</p>

<h1 align="center">CLIBox</h1>

<p align="center">
  Persistent terminals for all your projects, in any browser.<br>
  Self-hosted, installable on mobile, with KVM and GPU passthrough.
</p>

<p align="center">
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-13213A"></a>
  <a href="https://github.com/thaqiif/projectclibox/releases"><img alt="Version" src="https://img.shields.io/github/v/release/thaqiif/projectclibox?color=F5A524"></a>
  <a href="https://github.com/thaqiif/projectclibox/pkgs/container/clibox"><img alt="Container image" src="https://img.shields.io/badge/ghcr.io-thaqiif%2Fclibox-5CC8E0"></a>
</p>

CLIBox runs in one Docker container on your server. It gives you a monitor of
up to five live terminals side by side, a project list, and a file browser and
editor. You can open it from a laptop or a phone. Every terminal is a tmux
session, so closing the tab, losing Wi-Fi or switching devices never kills
what's running.

Use it to keep coding agents (Claude Code, Codex, OpenCode), dev servers,
builds and emulators running on a machine that stays on, and check in from
anywhere.

> [!CAUTION]
> **CLIBox has no login of its own, and never will.** Anyone who can reach it
> gets a full shell on your server, with your files, keys and tokens.
> Never expose its port to the internet directly. Put it behind
> [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/applications/)
> or reach it only over [Tailscale](https://tailscale.com/). See
> [Security](#security).

## Features

- **Monitor workspace.** Up to five terminals side by side on desktop, or as
  tabs on a phone. Drag terminals between panes; the layout is saved.
- **Terminals that stay running.** Terminals run in tmux and survive refreshes,
  disconnects and device switches. Stopped terminals reopen in their folder.
- **Projects and files.** Group terminals by project folder, and browse, edit
  and upload files next to the terminal.
- **Made for phones too.** An installable PWA with a terminal key row
  (Esc, Tab, Ctrl, arrows), themes and font scaling.
- **Hardware when you want it.** Optional KVM, Intel/AMD GPUs (VA-API, Vulkan,
  ROCm) and NVIDIA GPUs, detected by the installer.
- **Your tools, persisted.** `npm -g`, `pip --user` and
  [nanobrew](https://github.com/justrach/nanobrew) install into your home
  directory and survive image upgrades. No AI CLI is preinstalled; install the
  one you use.
- **Runs as a normal user.** The container needs no privileged mode or Docker
  socket, and runs as your host user's UID/GID.

## Install

On a Linux host with Docker and Docker Compose v2:

```bash
curl -fsSL https://raw.githubusercontent.com/thaqiif/projectclibox/master/install.sh | bash
```

The installer asks where to keep your data and projects, detects KVM and your
GPUs, writes `.env`, and starts CLIBox at <http://localhost:3011>. It uses
the published image `ghcr.io/thaqiif/clibox` when it can pull it, and
otherwise builds the image from source on your machine (that takes several
minutes and a few GB of RAM). Run it again later to change any answer. Add
`--yes` to accept the defaults, or `--dry-run` to see the `.env` without
changing anything.

To install from a checkout instead:

```bash
git clone https://github.com/thaqiif/projectclibox.git && cd projectclibox
./install.sh
```

Or do it by hand from a checkout: `cp .env.example .env`, edit it, then
`docker compose up -d`. To build the image yourself instead of pulling it,
run `docker compose up -d --build`.

> [!CAUTION]
> Keep CLIBox private. It has no login, so publishing its port gives a shell
> to the whole internet. See [Security](#security).

## Security

CLIBox leaves authentication to the network in front of it. It listens on
`127.0.0.1` by default; keep it that way unless one of these sits in front:

- **Cloudflare Tunnel + Cloudflare Access.** Publish CLIBox through a tunnel
  and add an Access application with a policy that allows only your
  identity (email, SSO or a hardware key). Requests without an Access login
  never reach the server.
- **Tailscale.** Bind CLIBox to the server's Tailscale address (set
  `HOST_BIND` to it) or use `tailscale serve`, so only devices on your
  tailnet can connect.

Do not publish the port on a public address, and do not rely on an
unguessable URL. Treat everyone who can open CLIBox as having your shell.

## Hardware

The base `compose.yml` maps no host devices, so it runs anywhere. Hardware is
opt-in, one overlay file each:

| Overlay | For |
|---|---|
| `hardware/kvm.yml` | QEMU/KVM guests, Android emulators, microVMs |
| `hardware/gpu.yml` | An Intel or AMD GPU: video encode/decode, Vulkan, GPU Chromium |
| `hardware/amd-compute.yml` | ROCm/OpenCL compute on AMD |
| `hardware/gpu-secondary.yml` | A second DRM GPU |
| `hardware/nvidia.yml` | NVIDIA GPUs via the NVIDIA Container Toolkit |

The installer turns on the ones your host supports. See
[docs/hardware.md](docs/hardware.md) for details and verification commands.

## Upgrading

With the published image:

```bash
docker compose pull && docker compose up -d
```

If you build from a git checkout, update it and rebuild:

```bash
git pull && docker compose up -d --build
```

Your home directory, database and projects live in host folders, so upgrades
and container rebuilds keep them. To upgrade on your own schedule, set
`CLIBOX_VERSION` in `.env` to a release such as `1.0.0`.

Coming from CLIWeb? Set `CLIBOX_HOME_DIR` to your existing home first. See
[Upgrading from CLIWeb](docs/operations.md#upgrading-from-cliweb).

## Documentation

- [Hardware passthrough](docs/hardware.md): KVM, Intel/AMD/NVIDIA GPUs, Chromium
- [Operating CLIBox](docs/operations.md): persistence, configuration, test
  deployments, backups, deploying updates
- [Changelog](CHANGELOG.md)

## Development

```bash
cd web
npm ci --include=dev --legacy-peer-deps
npm run dev        # http://localhost:3011
npm test && npm run lint && npm run typecheck
```

Pushing a `v*.*.*` tag builds the amd64/arm64 image, publishes it to GHCR,
and creates a GitHub release.

## Credits

CLIBox began as a fork of [CLIWeb](https://github.com/saadnvd1/cliweb) by
Saad Naveed and has since been largely rewritten. Released under the
[MIT license](LICENSE).
