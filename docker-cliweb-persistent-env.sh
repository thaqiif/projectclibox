#!/usr/bin/env bash

# Shared by the entrypoint and interactive shells. The image is disposable;
# these locations are deliberately inside the host-mounted CLIWeb home.
_cliweb_home="${HOME:-/home/cliweb}"
_cliweb_nanobrew_root="${CLIWEB_NANOBREW_ROOT:-/opt/nanobrew}"

export HOME="${_cliweb_home}"
export CLIWEB_NANOBREW_ROOT="${_cliweb_nanobrew_root}"
export NPM_CONFIG_PREFIX="${NPM_CONFIG_PREFIX:-${_cliweb_home}/.local}"
export NPM_CONFIG_USERCONFIG="${NPM_CONFIG_USERCONFIG:-${_cliweb_home}/.npmrc}"
export PYTHONUSERBASE="${PYTHONUSERBASE:-${_cliweb_home}/.local}"

_cliweb_add_path() {
    case ":${PATH:-}:" in
        *:"$1":*) ;;
        *) PATH="$1${PATH:+:${PATH}}" ;;
    esac
}

_cliweb_add_path "${_cliweb_home}/.local/sbin"
_cliweb_add_path "${_cliweb_home}/.local/bin"
_cliweb_add_path "${NPM_CONFIG_PREFIX}/bin"
_cliweb_add_path "${_cliweb_nanobrew_root}/prefix/bin"
export PATH

unset _cliweb_home _cliweb_nanobrew_root
