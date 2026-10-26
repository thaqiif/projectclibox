#!/usr/bin/env bash

# Shared by the entrypoint and interactive shells. The image is disposable;
# these locations are deliberately inside the host-mounted CLIBox home.
_clibox_home="${HOME:-/home/clibox}"
_clibox_nanobrew_root="${CLIBOX_NANOBREW_ROOT:-/opt/nanobrew}"

export HOME="${_clibox_home}"
export CLIBOX_NANOBREW_ROOT="${_clibox_nanobrew_root}"
export NPM_CONFIG_PREFIX="${NPM_CONFIG_PREFIX:-${_clibox_home}/.local}"
export NPM_CONFIG_USERCONFIG="${NPM_CONFIG_USERCONFIG:-${_clibox_home}/.npmrc}"
export PYTHONUSERBASE="${PYTHONUSERBASE:-${_clibox_home}/.local}"

_clibox_add_path() {
    case ":${PATH:-}:" in
        *:"$1":*) ;;
        *) PATH="$1${PATH:+:${PATH}}" ;;
    esac
}

_clibox_add_path "${_clibox_home}/.local/sbin"
_clibox_add_path "${_clibox_home}/.local/bin"
_clibox_add_path "${NPM_CONFIG_PREFIX}/bin"
_clibox_add_path "${_clibox_nanobrew_root}/prefix/bin"
export PATH

unset _clibox_home _clibox_nanobrew_root
