# Changelog

## 2026-08-29

### Changed

- Squashed database setup into one current baseline migration for fresh deployments.
- Renamed the application source and runtime directory to `cliweb` and `/opt/cliweb`, standardized provider terminology, and introduced a CLIWeb browser-terminal icon.
- Replaced Docker-managed home and Brew volumes with the Coolify-safe `/home/cliweb` host bind mount while retaining Homebrew's bottle-compatible Linux prefix.

### Fixed

- Assigned stable physical names to the home and Brew volumes so Compose project-name changes no longer select empty volumes.
- Mounted persistent Homebrew data at its supported Linux bottle prefix while retaining `/home/cliweb/brew` as an alias.
- Replaced the `/usr/local/bin/brew` symlink with a launcher so Homebrew no longer infers `/usr/local` as its prefix.
- Standardized the container locale on `C.UTF-8` to prevent locale initialization errors.

### Removed

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
