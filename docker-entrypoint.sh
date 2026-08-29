#!/usr/bin/env bash
set -euo pipefail

# Start as root only long enough to align the runtime user with the host and
# prepare the persisted home volume. The web server and all terminal shells are
# then launched as the unprivileged `cliweb` user.
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
BREW_STORAGE="${CLIWEB_BREW_PREFIX:-/home/linuxbrew/.linuxbrew}"
BREW_SOURCE="${CLIWEB_BREW_SOURCE:-/opt/cliweb-brew}"

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
    "${HOME}/.cache/Homebrew" \
    "${HOME}/.gitstate" \
    "${HOME}/.ssh" \
    "${BREW_STORAGE}"
chmod 700 "${HOME}/.ssh"

# npm -g and pip --user both land in the persisted home volume. This is the
# supported extension point for installing tools after the container starts.
export NPM_CONFIG_PREFIX="${NPM_CONFIG_PREFIX:-${HOME}/.local}"
export PYTHONUSERBASE="${PYTHONUSERBASE:-${HOME}/.local}"
export USER=cliweb
export LOGNAME=cliweb

# Ensure the persisted volume and the app's writable Next cache are usable by
# the remapped user. /opt dependencies remain root-owned and read-only.
chown -R cliweb:cliweb "${HOME}"

# The Brew directory inside the persisted home volume is mounted again at
# Homebrew's supported Linux prefix. The image snapshot avoids requiring a
# network connection during the first container start.
CLIWEB_BREW_PREFIX="${BREW_STORAGE}" \
CLIWEB_BREW_SOURCE="${BREW_SOURCE}" \
    /usr/local/libexec/cliweb-brew-bootstrap
chown -R cliweb:cliweb "${BREW_STORAGE}"

export HOMEBREW_PREFIX="${BREW_STORAGE}"
export HOMEBREW_REPOSITORY="${BREW_STORAGE}"
export HOMEBREW_CACHE="${HOME}/.cache/Homebrew"
export PATH="${BREW_STORAGE}/bin:${HOME}/brew/bin:${BREW_STORAGE}/sbin:${HOME}/brew/sbin:${NPM_CONFIG_PREFIX}/bin:${HOME}/.local/bin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin"
mkdir -p "${CLIWEB_REPO:-/opt/cliweb}/.next/cache"
chown -R cliweb:cliweb "${CLIWEB_REPO:-/opt/cliweb}/.next/cache"

# Keep Git identity and HTTPS credentials in the persisted home volume.
gosu cliweb git config --global credential.helper \
    "store --file=${HOME}/.gitstate/credentials"

export PORT="${CLIWEB_PORT:-3011}"
cd "${CLIWEB_REPO:-/opt/cliweb}"
exec setpriv --reuid=cliweb --regid=cliweb --init-groups -- npm start
