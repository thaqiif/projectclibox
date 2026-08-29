# Changelog

## 2026-08-29

### Fixed

- Mounted persistent Homebrew data at its supported Linux bottle prefix while retaining `/home/cliweb/brew` as an alias.
- Replaced the `/usr/local/bin/brew` symlink with a launcher so Homebrew no longer infers `/usr/local` as its prefix.
- Standardized the container locale on `C.UTF-8` to prevent locale initialization errors.

## 2026-08-28

### Added

- Added a persistent Homebrew installation rooted at `/home/cliweb/brew`.
- Added the supported Linux Homebrew prefix alias and a stable `brew` command path for bottle installs.
- Added a supported Linux Homebrew prefix alias and stable `brew` command path for bottle installs.

### Changed

- Renamed the container user and persistent home directory from `agent` to `cliweb`.
- Renamed the application branding from AgentOS to CLIWeb.

### Fixed

- Corrected the persisted Homebrew repository layout and added a non-destructive migration that preserves installed Cellar packages.

### Removed

- Removed dev-server management and its persistence, API, and UI surfaces.
- Removed integrated Git panels, project repository management, GitHub cloning, and related API/data modules.
