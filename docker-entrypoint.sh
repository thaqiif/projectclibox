#!/usr/bin/env bash
set -euo pipefail

# Start as root only long enough to align the runtime user with the host and
# prepare the persisted home volume. The web server and all terminal shells are
# then launched as the unprivileged `cliweb` user.
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
NANOBREW_ROOT="/opt/nanobrew"
NANOBREW_BIN="${CLIWEB_NANOBREW_BIN:-/usr/local/bin/nb}"

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

# npm -g and pip --user both land in the persisted home volume. This is the
# supported extension point for installing tools after the container starts.
export NPM_CONFIG_PREFIX="${NPM_CONFIG_PREFIX:-${HOME}/.local}"
export PYTHONUSERBASE="${PYTHONUSERBASE:-${HOME}/.local}"
export USER=cliweb
export LOGNAME=cliweb

# Ensure the persisted volumes and the app's writable Next cache are usable by
# the remapped user. /opt dependencies remain root-owned and read-only.
chown -R cliweb:cliweb "${HOME}" "${NANOBREW_ROOT}"

# nanobrew stores its package database, cache, Cellar, and command links below
# its fixed /opt/nanobrew root. The root is a host bind mount, so nb init is
# safe to repeat after container recreation and package installs persist.
CLIWEB_NANOBREW_BIN="${NANOBREW_BIN}" \
    /usr/local/libexec/cliweb-nanobrew-bootstrap
chown -R cliweb:cliweb "${NANOBREW_ROOT}"

export PATH="${NANOBREW_ROOT}/prefix/bin:${NPM_CONFIG_PREFIX}/bin:${HOME}/.local/bin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin"
mkdir -p "${CLIWEB_REPO:-/opt/cliweb}/.next/cache"
chown -R cliweb:cliweb "${CLIWEB_REPO:-/opt/cliweb}/.next/cache"

# Keep Git identity and HTTPS credentials in the persisted home volume.
gosu cliweb git config --global credential.helper \
    "store --file=${HOME}/.gitstate/credentials"

export PORT="${CLIWEB_PORT:-3011}"
cd "${CLIWEB_REPO:-/opt/cliweb}"
exec setpriv --reuid=cliweb --regid=cliweb --init-groups -- npm start
