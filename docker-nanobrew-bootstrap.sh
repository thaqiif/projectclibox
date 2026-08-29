#!/usr/bin/env bash
set -euo pipefail

# nanobrew currently uses /opt/nanobrew as its fixed Linux/Docker data root.
nanobrew_root="${CLIWEB_NANOBREW_ROOT:-/opt/nanobrew}"
nanobrew_bin="${CLIWEB_NANOBREW_BIN:-/usr/local/bin/nb}"

if [ ! -x "${nanobrew_bin}" ]; then
    echo "CLIWeb: nanobrew binary is missing at ${nanobrew_bin}" >&2
    exit 1
fi

mkdir -p "${nanobrew_root}"
"${nanobrew_bin}" init

if [ ! -d "${nanobrew_root}/prefix/bin" ]; then
    echo "CLIWeb: nanobrew failed to initialize at ${nanobrew_root}" >&2
    exit 1
fi

# A bind mount can preserve the Cellar and database while the public links are
# missing or stale. Re-link installed formulae on every container start so a
# redeploy exposes the same commands without reinstalling their packages.
installed_packages=$("${nanobrew_bin}" list --names 2>/dev/null || true)
while IFS= read -r package; do
    [ -n "${package}" ] || continue
    "${nanobrew_bin}" link "${package}" >/dev/null 2>&1 || true
done <<< "${installed_packages}"
