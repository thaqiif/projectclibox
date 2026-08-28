# Changelog

## 2026-08-28

### Added

- Added a persistent Homebrew installation rooted at `/home/cliweb/brew`.

### Changed

- Renamed the container user and persistent home directory from `agent` to `cliweb`.
- Renamed the application branding from AgentOS to CLIWeb.

### Removed

- Removed dev-server management and its persistence, API, and UI surfaces.
- Removed integrated Git panels, project repository management, GitHub cloning, and related API/data modules.
