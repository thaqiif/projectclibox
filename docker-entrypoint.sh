#!/usr/bin/env bash
set -euo pipefail

# Start as root only long enough to align the runtime user with the host and
# prepare the persisted home volume. The web server and all terminal shells are
# then launched as the unprivileged `cliweb` user.
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
NANOBREW_ROOT="${CLIWEB_NANOBREW_ROOT:-/opt/nanobrew}"
NANOBREW_BIN="${CLIWEB_NANOBREW_BIN:-/usr/local/bin/nb}"

# Keep every shell entry point on the same persistent npm/nanobrew contract.
. /usr/local/libexec/cliweb-persistent-env

if [ "$(id -g cliweb)" != "${PGID}" ]; then
    groupmod -o -g "${PGID}" cliweb
fi
if [ "$(id -u cliweb)" != "${PUID}" ]; then
    usermod -o -u "${PUID}" cliweb
fi

mkdir -p \
    "${HOME}/.cliweb" \
    "${HOME}/.config" \
    "${HOME}/.local/bin" \
    "${HOME}/.local/lib" \
    "${HOME}/.cache" \
    "${HOME}/.gitstate" \
    "${HOME}/.ssh" \
    "${NANOBREW_ROOT}"
chmod 700 "${HOME}/.ssh"

for shell_rc in "${HOME}/.bashrc" "${HOME}/.profile"; do
    touch "${shell_rc}"
    if ! grep -Fqx ". /usr/local/libexec/cliweb-persistent-env" "${shell_rc}"; then
        printf '\n# CLIWeb persistent package paths\n. /usr/local/libexec/cliweb-persistent-env\n' >> "${shell_rc}"
    fi
done

# npm -g and pip --user both land in the persisted home volume. This is the
# supported extension point for installing tools after the container starts.
export NPM_CONFIG_PREFIX="${NPM_CONFIG_PREFIX:-${HOME}/.local}"
export PYTHONUSERBASE="${PYTHONUSERBASE:-${HOME}/.local}"
export USER=cliweb
export LOGNAME=cliweb

# Ensure the persisted volumes and the mounted workspace are usable by the
# remapped user. /opt dependencies remain root-owned and read-only.
chown -R cliweb:cliweb "${HOME}" "${NANOBREW_ROOT}" /workspaces

# nanobrew stores its package database, cache, Cellar, and command links below
# its fixed /opt/nanobrew root. The root is a host bind mount, so nb init is
# safe to repeat after container recreation and package installs persist.
CLIWEB_NANOBREW_BIN="${NANOBREW_BIN}" \
CLIWEB_NANOBREW_ROOT="${NANOBREW_ROOT}" \
    /usr/local/libexec/cliweb-nanobrew-bootstrap
chown -R cliweb:cliweb "${NANOBREW_ROOT}"

# Re-source after bootstrap so a custom prefix is reflected in PATH, then
# persist npm's global prefix in the mounted user config as well as the
# process environment. This covers npm invocations that bypass CLIWeb's PTY.
. /usr/local/libexec/cliweb-persistent-env
gosu cliweb /usr/local/bin/npm config set prefix "${NPM_CONFIG_PREFIX}" --location=user
mkdir -p "${CLIWEB_REPO:-/opt/cliweb}/.next/cache"
chown -R cliweb:cliweb "${CLIWEB_REPO:-/opt/cliweb}/.next/cache"

# Keep Git identity and HTTPS credentials in the persisted home volume.
gosu cliweb git config --global credential.helper \
    "store --file=${HOME}/.gitstate/credentials"

export PORT="${CLIWEB_PORT:-3011}"
cd "${CLIWEB_REPO:-/opt/cliweb}"
exec setpriv --reuid=cliweb --regid=cliweb --init-groups -- npm start
