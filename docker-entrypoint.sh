#!/usr/bin/env bash
set -euo pipefail

# The entrypoint performs only small, bounded setup work. In particular it
# never recursively walks the workspace or persistent home on every start;
# that was a major source of cold-start cost in the old Node runtime.
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
NANOBREW_ROOT="${CLIWEB_NANOBREW_ROOT:-/opt/nanobrew}"
NANOBREW_BIN="${CLIWEB_NANOBREW_BIN:-/usr/local/bin/nb}"

. /usr/local/libexec/cliweb-persistent-env

if [ "$(id -g cliweb)" != "${PGID}" ]; then
    groupmod -o -g "${PGID}" cliweb
fi
if [ "$(id -u cliweb)" != "${PUID}" ]; then
    usermod -o -u "${PUID}" cliweb
fi

if [ -e /dev/kvm ]; then
    chgrp cliweb /dev/kvm 2>/dev/null || true
    chmod 660 /dev/kvm 2>/dev/null || true
fi

mkdir -p \
    "${HOME}/.cliweb" \
    "${HOME}/.config" \
    "${HOME}/.local/bin" \
    "${HOME}/.local/lib" \
    "${HOME}/.cache" \
    "${HOME}/.gitstate" \
    "${HOME}/.ssh" \
    "${NANOBREW_ROOT}" \
    /workspaces
chmod 700 "${HOME}/.ssh"

# Keep user-installed tools on PATH even when an installer creates a login
# shell file that shadows the default profile.
for shell_rc in "${HOME}/.bashrc" "${HOME}/.profile" "${HOME}/.bash_profile"; do
    touch "${shell_rc}"
    if ! grep -Fqx ". /usr/local/libexec/cliweb-persistent-env" "${shell_rc}"; then
        printf '\n# ProjectCliBox persistent package paths\n. /usr/local/libexec/cliweb-persistent-env\n' >> "${shell_rc}"
    fi
    chown cliweb:cliweb "${shell_rc}"
done

# Bind-mounted directories are intentionally changed only at their directory
# entry points. Existing project trees keep their ownership and are never
# recursively scanned during startup.
chown cliweb:cliweb \
    "${HOME}" \
    "${HOME}/.cliweb" \
    "${HOME}/.config" \
    "${HOME}/.local" \
    "${HOME}/.local/bin" \
    "${HOME}/.local/lib" \
    "${HOME}/.cache" \
    "${HOME}/.gitstate" \
    "${HOME}/.ssh" \
    "${NANOBREW_ROOT}" \
    /workspaces

# nanobrew is optional and persistent. It is initialized as the same
# unprivileged user that owns terminal processes, so package state does not
# depend on root-owned files in the host bind mount.
if [ -x "${NANOBREW_BIN}" ]; then
    gosu cliweb env \
        CLIWEB_NANOBREW_BIN="${NANOBREW_BIN}" \
        CLIWEB_NANOBREW_ROOT="${NANOBREW_ROOT}" \
        /usr/local/libexec/cliweb-nanobrew-bootstrap
fi

gosu cliweb git config --global credential.helper \
    "store --file=${HOME}/.gitstate/credentials"

cd /workspaces
exec setpriv --reuid=cliweb --regid=cliweb --init-groups -- \
    /usr/local/bin/projectclibox server
