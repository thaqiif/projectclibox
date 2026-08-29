#!/usr/bin/env bash
set -euo pipefail

brew_prefix="${HOMEBREW_PREFIX:-/home/linuxbrew/.linuxbrew}"
brew_executable="${brew_prefix}/bin/brew"

if [ "${brew_prefix}" = "/usr/local" ]; then
    echo "CLIWeb: refusing to run Homebrew with /usr/local as its prefix" >&2
    exit 1
fi

if [ ! -x "${brew_executable}" ]; then
    echo "CLIWeb: Homebrew is not initialized at ${brew_prefix}" >&2
    exit 1
fi

exec "${brew_executable}" "$@"
