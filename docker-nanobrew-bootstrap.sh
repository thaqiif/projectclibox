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
