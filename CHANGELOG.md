# Changelog

## 2026-08-29

### Added

- Added the Linux Docker host gateway alias so CLIWeb can reach APIs exposed by sibling containers through their published host ports.

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
