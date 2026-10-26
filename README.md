<p align="center">
  <img src="web/public/branding/clibox-terminal.svg" width="96" height="96" alt="CLIBox logo">
</p>

<h1 align="center">CLIBox</h1>

<p align="center">
  Persistent terminals for all your projects, in any browser.<br>
  Self-hosted, phone-friendly, with KVM and GPU passthrough.
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
GPUs, writes `.env`, and starts CLIBox at <http://localhost:3011>. Run it
again later to change any answer. Add `--yes` to accept the defaults, or
`--dry-run` to see the `.env` without changing anything.

To install from a checkout instead:

```bash
git clone https://github.com/thaqiif/projectclibox.git && cd projectclibox
./install.sh
```

Or do it by hand: `cp .env.example .env`, edit it, then `docker compose up -d`.

> [!WARNING]
> CLIBox gives full shell access to anyone who can reach it. By default it
> listens on localhost only. Before exposing it, put it behind an
> authenticating proxy or VPN (for example Cloudflare Access, Tailscale or
> Authelia).

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

```bash
docker compose pull && docker compose up -d
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
