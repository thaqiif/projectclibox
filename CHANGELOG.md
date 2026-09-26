# Changelog

## 1.0.0 — 2026-09-26

CLIWeb is now **CLIBox**, the first versioned, public release.

### Added

- `install.sh`: detects KVM and Intel/AMD/NVIDIA GPUs, writes `.env` (keeping lines you added) and starts CLIBox. Supports `--yes`, `--dry-run` and piping from curl.
- Hardware overlays in `hardware/` (`kvm`, `gpu`, `gpu-secondary`, `amd-compute`, `nvidia`), enabled through `COMPOSE_FILE`.
- Published images at `ghcr.io/thaqiif/clibox` for amd64 and arm64, built by a tag-triggered release workflow, plus CI for lint, typecheck, tests and the installer. Both run on self-hosted runners.
- New box logo, maskable PWA icon and apple-touch icon.

### Changed

- The monitor workspace is the only workbench; the Monitor toggle and the single-terminal view are gone. Clicking a terminal in the sidebar opens it in a free pane, or beside the others.
- Renamed throughout: the app directory is `web/`, the container user is `clibox`, settings are `CLIBOX_*`, data lives in `~/.clibox/clibox.db`, and the host home is `CLIBOX_HOME_DIR` (default `./data/home`).
- `compose.yml` maps no host devices by default, so it starts on any Docker host.
- The README is now a product page; operational detail moved to `docs/hardware.md` and `docs/operations.md`.

### Upgrading from CLIWeb

Set `CLIBOX_HOME_DIR` to your existing home (e.g. `/home/cliweb`) and choose hardware overlays. The first boot moves `~/.cliweb*` data into place; `CLIWEB_*` variables, `/home/cliweb` paths and saved browser settings keep working. See `docs/operations.md`.

## 2026-09-11

### Changed

- The two HTML5 drag payload types are now declared once in `lib/drag-types.ts` and imported by every drag source and drop target. They were repeated as string literals at four sites, where a typo on one side would have made a drag fail silently — the browser simply never offers the drop.
- The mobile header and the terminal key row are now opaque rather than glass. Both are anchored to a viewport edge, so a saved-to-home-screen iOS session draws them under the status bar and the home indicator, where a translucent material frosted the terminal scrolling beneath it.
- Dragging a terminal out of the sidebar now opens the monitor workspace, so the terminal has somewhere to land. A drag that ends without a drop closes it again, leaving the workbench as it was.

### Fixed

- New browser terminals now start on the persisted shell environment. tmux was starting every pane as a login shell, and Debian's `/etc/profile` resets `PATH` to the system default, so tools installed under the persisted home — Claude included — reported "command not found" until `~/.bashrc` was sourced by hand.
- The entrypoint now maintains `~/.bash_profile` alongside `~/.bashrc` and `~/.profile`. Bash reads only the first of those three for a login shell, so a `~/.bash_profile` created by a tool installer shadowed the persisted package paths.
- The ignore files no longer refer to the application by its pre-rename name. `.gitignore`, `.dockerignore` and `cliweb/.gitignore` still excluded `agent-os/` paths that no longer exist, and `cliweb/.gitignore` protected `agent-os.db` while the local working database is `cliweb.db` — so a development database and its write-ahead log were not ignored. Agent session state (`.omc/`) is now ignored and kept out of the Docker build context, which had been copying it into the image.
- The app's font stacks now actually apply. `globals.css` referenced `var(--font-geist-sans)` and `var(--font-geist-mono)`, which nothing defined once the Geist font was dropped, so the whole `--font-sans`/`--font-mono` custom properties were invalid and every face fell back to Tailwind's generic system stack. The undefined references are gone; sans now resolves to SF Pro with the platform UI face as fallback, mono to JetBrains Mono, and the code editor and path/port/ID text use them.

### Removed

- Removed the mobile swipe-to-next-terminal gesture. It decided on sideways distance alone and was never suppressed while the terminal consumed the same touch as a scroll, so an ordinary scroll could switch terminals. Terminals are switched from the terminal list.
- Removed the mobile drawer's drag gesture. Scrolling the terminal is now the only thing on a phone that moves under a finger; the drawer opens from the header button and closes from the scrim.
- Removed the quick switcher and the ripgrep code search that its second tab was the only way to reach, along with the `⌘K`/`Ctrl+K` shortcut and the sidebar and welcome-screen entry points to it.
- Removed find-in-terminal search. Nothing on screen opened it — the only trigger was `Ctrl/Cmd+Shift+F` — so the search bar, the xterm search addon and the shortcut are gone.
- Removed the sidebar's terminal multi-select. Shift-clicking a card started a selection that no action consumed, while every further click toggled selection instead of opening a terminal; the selection store, the range helper and the checkboxes are gone.
- Removed `POST /api/exec`, which ran an arbitrary shell command and had no caller anywhere in the repository.
- Removed `react-syntax-highlighter` and its type package. The dependency was declared but never imported anywhere; markdown code blocks are styled by the prose theme instead.
- Removed `hooks/useKeyRepeat.ts`, a press-and-hold key repeater with haptics that nothing imported — the terminal key row has its own repeat handling.
- Removed `components/ui/badge.tsx` and the unused `GenericSkeletonLoader`, and stopped exporting the monitor-workspace and skeleton helpers that are only used inside their own module.
- Removed the gesture-physics helpers from `lib/spring.ts` — momentum projection, rubber-banding and pointer velocity tracking — left behind when the mobile drawer's drag gesture was removed.
- Removed the unused `copiedTerminalId` view state and the `handleCreateProject` view handler, which was destructured by the desktop view and never called; projects are created through the shared `useCreateProject` mutation.
- Removed the root `esbuild` devDependency, which no script, test or build step referenced.
- Removed `stores/fileOpen.ts` and the `valtio` dependency. The store handed open-file requests to the panes, but nothing ever dispatched one, so the consuming effect could never fire.
- Removed the terminal list's `handleBulkDelete` mutation — the last consumer of the multi-select that was already removed.
- Removed the terminal card's hover-preview machinery (hover-open state, the delayed-open timeout and the menu-open coordination) and the project card's "Open in editor" menu item, which had no handler wired to it.
- Removed the terminal toolbar's `visible` prop, which was always passed as `true`, and the `Ctrl+D`/`Ctrl+Z`/`Ctrl+L` entries from the key row's special-key table, which no action consumed.
- Removed the `isMobile` and `hydrated` fields from the pane context value; nothing read them, and hydration is tracked internally.
- Removed the unused methods from the terminal-state registry — `register`, `get`, `remove`, `clearPane`, `clear` and the `size` getter — leaving the save/restore calls the panes actually use.
- Removed the unused surface from `useTerminalConnection`: the `connected` flag, the scroll-restoration callbacks and the resize trigger, none of which had a consumer.
- Removed re-exports nothing imported: `fileKeys` and `DirectoryData` from the file queries, `TerminalListProps` from the terminal list, `FileNode` and `getLanguageFromExtension` from the file utilities, and the item-config factories and prop types from the `a/` component primitives.

## 2026-09-06

### Added

- Web terminals can now use hardware virtualization by mapping the host's `/dev/kvm` device into the container (QEMU/KVM guests, Android emulators, microVMs). Note: the host must expose `/dev/kvm`.

### Changed

- The entrypoint now grants the unprivileged `cliweb` user access to a passed-in `/dev/kvm` device automatically.

## 2026-08-29

### Added

- Added the Linux Docker host gateway alias so CLIWeb can reach APIs exposed by sibling containers through their published host ports.
- Added Debian's `ruby-full` package to provide Ruby, RubyGems, and the standard Ruby libraries in the container.

### Changed

- Replaced the persistent Homebrew integration with nanobrew's prebuilt Docker binary and `/home/cliweb/nanobrew` host storage mounted at `/opt/nanobrew`.
- Squashed database setup into one current baseline migration for fresh deployments.
- Renamed the application source and runtime directory to `cliweb` and `/opt/cliweb`, standardized provider terminology, and introduced a CLIWeb browser-terminal icon.
- Replaced Docker-managed home and Brew volumes with the Coolify-safe `/home/cliweb` host bind mount while retaining Homebrew's bottle-compatible Linux prefix.

### Fixed

- Replaced the unavailable `nanobrew/nb` Docker image reference with verified architecture-specific nanobrew GitHub release downloads.
- Replaced the remaining inline robot mark in the terminal list header with the shared CLIWeb icon.
- Moved favicon, Apple touch icon, and PWA icon references to CLIWeb-specific URLs so deployments cannot reuse the retired cached icon.
- Assigned stable physical names to the home and Brew volumes so Compose project-name changes no longer select empty volumes.
- Mounted persistent Homebrew data at its supported Linux bottle prefix while retaining `/home/cliweb/brew` as an alias.
- Replaced the `/usr/local/bin/brew` symlink with a launcher so Homebrew no longer infers `/usr/local` as its prefix.
- Standardized the container locale on `C.UTF-8` to prevent locale initialization errors.
- Persisted global npm installs and restored nanobrew command links across CLIWeb redeploys.
- Switched the runtime image to Debian Trixie so nanobrew Linux bottles requiring glibc 2.38 can run.
- Fixed ownership of the mounted `/workspaces` tree so CLIWeb can create and modify workspace directories.

### Removed

- Removed Homebrew bootstrap, launcher, prefix environment, and persistence mount configuration.
- Removed unused project launch-provider, model, and prompt fields from the baseline database schema, API, terminal records, and UI.

## 2026-08-28

### Added

- Added a persistent Homebrew installation rooted at `/home/cliweb/brew`.
- Added the supported Linux Homebrew prefix alias and a stable `brew` command path for bottle installs.
- Added a supported Linux Homebrew prefix alias and stable `brew` command path for bottle installs.

### Changed

- Standardized the container user and persistent home directory as `cliweb`.
- Standardized the application branding as CLIWeb.

### Fixed

- Corrected the persisted Homebrew repository layout and added a non-destructive migration that preserves installed Cellar packages.

### Removed

- Removed dev-server management and its persistence, API, and UI surfaces.
- Removed integrated Git panels, project repository management, GitHub cloning, and related API/data modules.
