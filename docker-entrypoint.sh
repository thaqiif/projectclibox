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

# When devices are passed in (see docker-compose.yml), make sure the
# unprivileged runtime user can open them. Under runc the mapped nodes may
# be 0666 root:root, but other runtimes preserve the host's 0660
# root:kvm / root:video / root:render; either way, chgrping them to the
# remapped cliweb group lets `cliweb` use hardware virtualization and every
# GPU (Intel, AMD amdgpu, virtio-gpu) while keeping other container processes
# out. This sidesteps host GID mismatches (e.g. host render:992 vs Debian
# container) and survives PUID/PGID remapping above, unlike group_add which
# setpriv --init-groups below would drop. The glob covers multi-GPU hosts
# (card0/card1, renderD128/renderD129, …) and /dev/kfd (AMD ROCm/OpenCL
# compute). Each node is guarded so the container still starts on hosts
# without KVM, DRI, or KFD.
if [ -e /dev/kvm ]; then
    chgrp cliweb /dev/kvm
    chmod 660 /dev/kvm
fi

for dev in /dev/dri/card* /dev/dri/renderD* /dev/kfd; do
    [ -e "$dev" ] || continue
    chgrp cliweb "$dev"
    chmod 660 "$dev"
done

mkdir -p \
    "${HOME}/.cliweb" \
    "${HOME}/.config" \
    "${HOME}/.local/bin" \
    "${HOME}/.local/lib" \
    "${HOME}/.cache" \
    "${HOME}/.gitstate" \
    "${HOME}/.ssh" \
    "${NANOBREW_ROOT}"

# Pre-create the profile data directory when CLIWEB_PROFILE is set so the
# app never has to self-bootstrap its DB folder (see lib/db/index.ts).
PROFILE_SUFFIX=""
if [ -n "${CLIWEB_PROFILE:-}" ]; then
    # Match lib/runtime-environment.ts cliwebProfileSuffix(): slugify to
    # [a-z0-9_-] and collapse runs of other characters to a single dash.
    slug=$(printf '%s' "${CLIWEB_PROFILE}" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9_-]+/-/g; s/^[-._]+//; s/[-._]+$//')
    if [ -n "${slug}" ] && [ "${slug}" != "default" ]; then
        PROFILE_SUFFIX="-${slug}"
        mkdir -p "${HOME}/.cliweb${PROFILE_SUFFIX}"
    fi
fi
chmod 700 "${HOME}/.ssh"

# Guard against two deployments sharing this persisted home mount with
# different PUID/PGID. Ownership is applied with chown -R on every boot
# below, so a second deployment with different ids would steal ownership of
# files the first deployment (still running) needs to access - the other
# instance then corrupts or crashes with permission errors. Record the
# current deployment's ownership in a marker and refuse to start mismatched
# deployments: the fix is to set identical PUID/PGID on both, or give each
# deployment its own persisted home on the host.
OWNER_MARKER="${HOME}/.cliweb/.deployment-owner"
WANT_OWNER="${PUID}:${PGID}"
if [ -f "${OWNER_MARKER}" ]; then
    existing_owner=$(cat "${OWNER_MARKER}" 2>/dev/null || echo "")
    if [ -n "${existing_owner}" ] && [ "${existing_owner}" != "${WANT_OWNER}" ]; then
        echo "This persisted home is owned by UID owner ${existing_owner} (deployment owner marker ${OWNER_MARKER})." >&2
        echo "This deployment wants ${WANT_OWNER}. Starting would chown the shared /home and break the other deployment (permission errors)." >&2
        echo "Fix: set identical PUID and PGID on every deployment that shares this home volume, or mount a separate home path for this deployment." >&2
        exit 1
    fi
fi
echo "${WANT_OWNER}" > "${OWNER_MARKER}"

# `.bash_profile` is on this list because bash reads only the *first* of
# ~/.bash_profile, ~/.bash_login and ~/.profile for a login shell. Tool
# installers (bun, rustup) create ~/.bash_profile, which then shadows
# ~/.profile and leaves the persisted package paths off PATH — /etc/profile has
# already reset PATH to the system default by that point.
for shell_rc in "${HOME}/.bashrc" "${HOME}/.profile" "${HOME}/.bash_profile"; do
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
