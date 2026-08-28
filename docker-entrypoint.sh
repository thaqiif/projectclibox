#!/usr/bin/env bash
set -euo pipefail

# Start as root only long enough to align the runtime user with the host and
# prepare the persisted home volume. The web server and all terminal shells are
# then launched as the unprivileged `agent` user.
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

if [ "$(id -g agent)" != "${PGID}" ]; then
    groupmod -o -g "${PGID}" agent
fi
if [ "$(id -u agent)" != "${PUID}" ]; then
    usermod -o -u "${PUID}" agent
fi

mkdir -p \
    "${HOME}/.cliweb" \
    "${HOME}/.config" \
    "${HOME}/.local/bin" \
    "${HOME}/.local/lib" \
    "${HOME}/.cache" \
    "${HOME}/.gitstate" \
    "${HOME}/.ssh"
chmod 700 "${HOME}/.ssh"

# npm -g and pip --user both land in the persisted home volume. This is the
# supported extension point for installing tools after the container starts.
export NPM_CONFIG_PREFIX="${NPM_CONFIG_PREFIX:-${HOME}/.local}"
export PYTHONUSERBASE="${PYTHONUSERBASE:-${HOME}/.local}"
export PATH="${NPM_CONFIG_PREFIX}/bin:${HOME}/.local/bin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin"
export USER=agent
export LOGNAME=agent

# Ensure the persisted volume and the app's writable Next cache are usable by
# the remapped user. /opt dependencies remain root-owned and read-only.
chown -R agent:agent "${HOME}"
mkdir -p "${CLIWEB_REPO:-/opt/agent-os}/.next/cache"
chown -R agent:agent "${CLIWEB_REPO:-/opt/agent-os}/.next/cache"

# Keep Git identity and HTTPS credentials in the persisted home volume.
gosu agent git config --global credential.helper \
    "store --file=${HOME}/.gitstate/credentials"

export PORT="${CLIWEB_PORT:-3011}"
cd "${CLIWEB_REPO:-/opt/agent-os}"
exec setpriv --reuid=agent --regid=agent --init-groups -- npm start
