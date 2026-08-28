#!/usr/bin/env bash
set -euo pipefail

# Start as root only long enough to align the runtime user with the host and
# prepare the persisted home volume. The web server and all terminal shells are
# then launched as the unprivileged `cliweb` user.
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
BREW_STORAGE="${CLIWEB_BREW_PREFIX:-${HOME}/brew}"
BREW_SOURCE="${CLIWEB_BREW_SOURCE:-/opt/cliweb-brew}"
HOMEBREW_SYSTEM_PREFIX="${HOMEBREW_PREFIX:-/home/linuxbrew/.linuxbrew}"
BREW_REPOSITORY="${BREW_STORAGE}/Homebrew"

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

# The whole /home/cliweb tree is persisted by compose. Keep Homebrew's
# repository and all formulae under /home/cliweb/brew so rebuilds do not remove
# user-installed brew dependencies. The image snapshot avoids requiring a
# network connection during the first container start.
if [ ! -L "${HOMEBREW_SYSTEM_PREFIX}" ]; then
    if [ -e "${HOMEBREW_SYSTEM_PREFIX}" ]; then
        echo "CLIWeb: Homebrew system prefix ${HOMEBREW_SYSTEM_PREFIX} already exists" >&2
        exit 1
    fi
    mkdir -p "$(dirname "${HOMEBREW_SYSTEM_PREFIX}")"
    ln -s "${BREW_STORAGE}" "${HOMEBREW_SYSTEM_PREFIX}"
fi

if [ ! -x "${BREW_STORAGE}/bin/brew" ]; then
    if [ -n "$(find "${BREW_STORAGE}" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
        echo "CLIWeb: Homebrew storage ${BREW_STORAGE} is not empty and is not initialized" >&2
        exit 1
    fi
    if [ ! -x "${BREW_SOURCE}/bin/brew" ]; then
        echo "CLIWeb: Homebrew bootstrap source is missing at ${BREW_SOURCE}" >&2
        exit 1
    fi
    mkdir -p "${BREW_REPOSITORY}" "${BREW_STORAGE}/bin"
    cp -a "${BREW_SOURCE}/." "${BREW_REPOSITORY}/"
    ln -s ../Homebrew/bin/brew "${BREW_STORAGE}/bin/brew"
fi
chown -R cliweb:cliweb "${BREW_STORAGE}"
ln -sfn "${BREW_STORAGE}/bin/brew" /usr/local/bin/brew

export HOMEBREW_PREFIX="${HOMEBREW_SYSTEM_PREFIX}"
export HOMEBREW_REPOSITORY="${HOMEBREW_SYSTEM_PREFIX}/Homebrew"
export HOMEBREW_CACHE="${HOME}/.cache/Homebrew"
export PATH="${HOMEBREW_SYSTEM_PREFIX}/bin:${BREW_STORAGE}/bin:${HOMEBREW_SYSTEM_PREFIX}/sbin:${BREW_STORAGE}/sbin:${NPM_CONFIG_PREFIX}/bin:${HOME}/.local/bin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin"
mkdir -p "${CLIWEB_REPO:-/opt/agent-os}/.next/cache"
chown -R cliweb:cliweb "${CLIWEB_REPO:-/opt/agent-os}/.next/cache"

# Keep Git identity and HTTPS credentials in the persisted home volume.
gosu cliweb git config --global credential.helper \
    "store --file=${HOME}/.gitstate/credentials"

export PORT="${CLIWEB_PORT:-3011}"
cd "${CLIWEB_REPO:-/opt/agent-os}"
exec setpriv --reuid=cliweb --regid=cliweb --init-groups -- npm start
