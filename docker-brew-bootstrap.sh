#!/usr/bin/env bash
set -euo pipefail

brew_storage="${CLIWEB_BREW_PREFIX:-/home/linuxbrew/.linuxbrew}"
brew_source="${CLIWEB_BREW_SOURCE:-/opt/cliweb-brew}"
brew_legacy="${CLIWEB_BREW_LEGACY:-}"
source_marker="${brew_source}/Library/Homebrew/brew.sh"
storage_marker="${brew_storage}/Library/Homebrew/brew.sh"

if [ ! -f "${source_marker}" ] || [ ! -x "${brew_source}/bin/brew" ]; then
    echo "CLIWeb: Homebrew bootstrap source is incomplete at ${brew_source}" >&2
    exit 1
fi

mkdir -p "${brew_storage}"

# Seed an empty persisted Brew directory from the image snapshot. The same
# directory is mounted at /home/cliweb/brew and at the prefix required by Linux
# bottles.
if [ ! -f "${storage_marker}" ]; then
    if [ -n "${brew_legacy}" ] && [ -d "${brew_legacy}" ]; then
        cp -a "${brew_legacy}/." "${brew_storage}/"
    fi

    # Older CLIWeb images also nested the repository one directory too deep.
    # Replace only that broken launcher before seeding the repository at root.
    if [ -L "${brew_storage}/bin/brew" ]; then
        unlink "${brew_storage}/bin/brew"
    fi
    if [ ! -f "${storage_marker}" ]; then
        cp -a "${brew_source}/." "${brew_storage}/"
    fi
fi

if [ ! -f "${storage_marker}" ] || [ ! -x "${brew_storage}/bin/brew" ]; then
    echo "CLIWeb: Homebrew failed to initialize at ${brew_storage}" >&2
    exit 1
fi
