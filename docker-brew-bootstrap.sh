#!/usr/bin/env bash
set -euo pipefail

brew_storage="${CLIWEB_BREW_PREFIX:-/home/cliweb/brew}"
brew_source="${CLIWEB_BREW_SOURCE:-/opt/cliweb-brew}"
source_marker="${brew_source}/Library/Homebrew/brew.sh"
storage_marker="${brew_storage}/Library/Homebrew/brew.sh"

if [ ! -f "${source_marker}" ] || [ ! -x "${brew_source}/bin/brew" ]; then
    echo "CLIWeb: Homebrew bootstrap source is incomplete at ${brew_source}" >&2
    exit 1
fi

mkdir -p "${brew_storage}"

# Older CLIWeb images incorrectly nested the Homebrew repository one directory
# too deep. Seed the repository at the prefix root while leaving Cellar and all
# other user-installed data untouched.
if [ ! -f "${storage_marker}" ]; then
    if [ -L "${brew_storage}/bin/brew" ]; then
        unlink "${brew_storage}/bin/brew"
    fi
    cp -a "${brew_source}/." "${brew_storage}/"
fi

if [ ! -f "${storage_marker}" ] || [ ! -x "${brew_storage}/bin/brew" ]; then
    echo "CLIWeb: Homebrew failed to initialize at ${brew_storage}" >&2
    exit 1
fi
