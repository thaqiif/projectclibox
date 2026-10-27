#!/usr/bin/env bash
# CLIBox installer.
#
#   curl -fsSL https://raw.githubusercontent.com/thaqiif/projectclibox/master/install.sh | bash
#   ./install.sh            # from a checkout
#
# Detects KVM and GPUs, writes .env (keeping any lines you added), then pulls
# the published image (or builds it from source when it cannot) and starts
# the container. Re-run it any time to change the answers.
#
# Options:
#   --yes        accept every default and detected device without asking
#   --dir DIR    where to install when not run from a checkout (default ./clibox)
#   --ref REF    git ref (branch or tag) to download (default master)
#   --dry-run    print the .env it would write, change nothing
#   --no-start   write the configuration but do not start the container
set -euo pipefail

REPO_SLUG="thaqiif/projectclibox"
REF="master"
INSTALL_DIR=""
ASSUME_YES=0
DRY_RUN=0
START=1
# Test hooks: read devices from a fake tree instead of the host's.
SYSFS_ROOT="${CLIBOX_SYSFS_ROOT:-/sys}"
DEV_ROOT="${CLIBOX_DEV_ROOT:-}"

while [ $# -gt 0 ]; do
    case "$1" in
        --yes|-y) ASSUME_YES=1 ;;
        --dir) INSTALL_DIR="$2"; shift ;;
        --ref) REF="$2"; shift ;;
        --dry-run) DRY_RUN=1; START=0 ;;
        --no-start) START=0 ;;
        -h|--help) sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "Unknown option: $1 (see --help)" >&2; exit 2 ;;
    esac
    shift
done

bold=""; dim=""; reset=""
if [ -t 1 ]; then bold=$'\e[1m'; dim=$'\e[2m'; reset=$'\e[0m'; fi
say() { printf '%s\n' "$*"; }
step() { printf '\n%s%s%s\n' "$bold" "$*" "$reset"; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }

# Prompts read from the terminal even when the script itself is piped in.
TTY=""
if [ "$ASSUME_YES" -eq 0 ] && [ -r /dev/tty ] && { : < /dev/tty; } 2>/dev/null; then
    TTY=/dev/tty
fi

# ask VAR "Question" default
ask() {
    local __var="$1" __question="$2" __default="$3" __reply=""
    if [ -n "$TTY" ]; then
        printf '%s %s[%s]%s ' "$__question" "$dim" "$__default" "$reset" > "$TTY"
        IFS= read -r __reply < "$TTY" || true
    fi
    printf -v "$__var" '%s' "${__reply:-$__default}"
}

# confirm "Question" y|n  -> exit status
confirm() {
    local answer
    ask answer "$1 (y/n)" "$2"
    case "$answer" in [Yy]*) return 0 ;; *) return 1 ;; esac
}

# --- Where the compose files live -------------------------------------------

script_dir=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

if [ -z "$INSTALL_DIR" ] && [ -n "$script_dir" ] && [ -f "$script_dir/compose.yml" ]; then
    INSTALL_DIR="$script_dir"
fi
INSTALL_DIR="${INSTALL_DIR:-$PWD/clibox}"

# The whole source tree, not just the compose files, so the image can be
# built here when the published one cannot be pulled.
fetch_source() {
    local url="https://codeload.github.com/${REPO_SLUG}/tar.gz/${REF}"
    command -v curl >/dev/null || die "curl is required to download CLIBox."
    command -v tar >/dev/null || die "tar is required to download CLIBox."
    mkdir -p "$INSTALL_DIR"
    curl -fsSL "$url" | tar -xz -C "$INSTALL_DIR" --strip-components=1 \
        || die "could not download CLIBox from $url"
}

# --- Hardware detection -----------------------------------------------------

# One line per DRM GPU: "<kind> <card node> <render node>". Kinds: amd,
# intel, nvidia, virtio, other. Names are the host's, from sysfs.
detect_gpus() {
    local card vendor kind render
    for card in "$SYSFS_ROOT"/class/drm/card[0-9]*; do
        case "$(basename "$card")" in *-*) continue ;; esac
        [ -r "$card/device/vendor" ] || continue
        vendor="$(cat "$card/device/vendor")"
        case "$vendor" in
            0x1002) kind=amd ;;
            0x8086) kind=intel ;;
            0x10de) kind=nvidia ;;
            0x1af4) kind=virtio ;;
            *) kind=other ;;
        esac
        render="$(ls "$card/device/drm" 2>/dev/null | grep -m1 '^renderD' || true)"
        [ -n "$render" ] || continue
        printf '%s /dev/dri/%s /dev/dri/%s\n' "$kind" "$(basename "$card")" "$render"
    done
}

gpu_label() {
    case "$1" in
        amd) echo "AMD" ;; intel) echo "Intel" ;; nvidia) echo "NVIDIA" ;;
        virtio) echo "virtio (virtual)" ;; *) echo "other" ;;
    esac
}

nvidia_runtime_ready() {
    command -v docker >/dev/null && docker info 2>/dev/null | grep -qi 'runtimes:.*nvidia'
}

# --- .env handling ----------------------------------------------------------

ENV_FILE="$INSTALL_DIR/.env"
ENV_DRAFT=""

env_get() {
    [ -f "$ENV_FILE" ] || return 0
    grep -E "^$1=" "$ENV_FILE" | tail -n1 | cut -d= -f2- || true
}

# Set KEY=VALUE in the draft, replacing an existing (or commented-out) line.
env_set() {
    local key="$1" value="$2"
    if grep -qE "^#? ?$key=" "$ENV_DRAFT"; then
        awk -v k="$key" -v v="$value" '
            !done && $0 ~ "^#? ?" k "=" { print k "=" v; done = 1; next }
            { print }' "$ENV_DRAFT" > "$ENV_DRAFT.tmp" && mv "$ENV_DRAFT.tmp" "$ENV_DRAFT"
    else
        printf '%s=%s\n' "$key" "$value" >> "$ENV_DRAFT"
    fi
}

env_unset() {
    grep -vE "^$1=" "$ENV_DRAFT" > "$ENV_DRAFT.tmp" || true
    mv "$ENV_DRAFT.tmp" "$ENV_DRAFT"
}

# --- Run --------------------------------------------------------------------

say "${bold}CLIBox installer${reset}"

if [ "$(uname -s)" != "Linux" ]; then
    say "Note: hardware passthrough (KVM, GPUs) needs a Linux host; it is skipped here."
fi

if [ "$DRY_RUN" -eq 0 ]; then
    command -v docker >/dev/null || die "Docker is not installed. See https://docs.docker.com/engine/install/"
    docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required (the 'docker compose' command)."
fi

if [ ! -f "$INSTALL_DIR/compose.yml" ]; then
    [ "$DRY_RUN" -eq 1 ] && die "no compose.yml in $INSTALL_DIR (a dry run does not download)."
    step "Downloading CLIBox ($REF) into $INSTALL_DIR"
    fetch_source
fi

ENV_DRAFT="$(mktemp)"
trap 'rm -f "$ENV_DRAFT" "$ENV_DRAFT.tmp"' EXIT
if [ -f "$ENV_FILE" ]; then
    cp "$ENV_FILE" "$ENV_DRAFT"
elif [ -f "$INSTALL_DIR/.env.example" ]; then
    cp "$INSTALL_DIR/.env.example" "$ENV_DRAFT"
fi

step "Basics"
default_uid="${SUDO_UID:-$(id -u)}"
default_gid="${SUDO_GID:-$(id -g)}"
if [ "$default_uid" = "0" ]; then default_uid=1000; default_gid=1000; fi

current="$(env_get CLIBOX_HOME_DIR)"
ask home_dir "Persisted home directory (shell config, tools, CLIBox data)" "${current:-./data/home}"
current="$(env_get WORKSPACE_DIR)"
ask workspace_dir "Projects folder, mounted at /workspaces" "${current:-./workspaces}"
current="$(env_get HOST_PORT)"
ask host_port "Port" "${current:-3011}"
host_bind="$(env_get HOST_BIND)"
host_bind="${host_bind:-127.0.0.1}"
if [ "$host_bind" = "127.0.0.1" ]; then
    say "CLIBox has no login: anyone who can reach it gets a shell on this machine."
    say "Keep it on localhost and reach it through Cloudflare Access or Tailscale."
    if confirm "Listen on every network interface anyway (only on a network you fully trust)?" n; then
        host_bind=0.0.0.0
    fi
fi

env_set CLIBOX_HOME_DIR "$home_dir"
env_set WORKSPACE_DIR "$workspace_dir"
env_set HOST_PORT "$host_port"
env_set HOST_BIND "$host_bind"
current="$(env_get PUID)"
env_set PUID "${current:-$default_uid}"
current="$(env_get PGID)"
env_set PGID "${current:-$default_gid}"

step "Hardware"
compose_files="compose.yml"
for key in CLIBOX_GPU_CARD CLIBOX_GPU_RENDER CLIBOX_GPU2_CARD CLIBOX_GPU2_RENDER; do
    env_unset "$key"
done

if [ -e "$DEV_ROOT/dev/kvm" ]; then
    if confirm "KVM found. Pass /dev/kvm through for VMs and emulators?" y; then
        compose_files="$compose_files:hardware/kvm.yml"
    fi
else
    say "No /dev/kvm: skipping hardware virtualization."
fi

mapfile -t gpus < <(detect_gpus)
primary=""
nvidia_seen=0
for gpu in "${gpus[@]}"; do
    read -r kind card render <<< "$gpu"
    say "Found $(gpu_label "$kind") GPU at $card ($render)"
    [ "$kind" = nvidia ] && nvidia_seen=1
done

# Prefer a real Intel/AMD GPU for the DRM passthrough; virtio and NVIDIA are
# handled separately below.
drm_candidates=()
for gpu in "${gpus[@]}"; do
    case "${gpu%% *}" in amd|intel) drm_candidates+=("$gpu") ;; esac
done

if [ "${#drm_candidates[@]}" -gt 1 ] && [ -n "$TTY" ]; then
    say "More than one GPU can be the primary one:"
    for i in "${!drm_candidates[@]}"; do
        read -r kind card _ <<< "${drm_candidates[$i]}"
        say "  $((i + 1))) $(gpu_label "$kind") at $card"
    done
    ask choice "Which should be primary?" 1
    case "$choice" in ''|*[!0-9]*) choice=1 ;; esac
    if [ "$choice" -lt 1 ] || [ "$choice" -gt "${#drm_candidates[@]}" ]; then choice=1; fi
    primary="${drm_candidates[$((choice - 1))]}"
elif [ "${#drm_candidates[@]}" -ge 1 ]; then
    primary="${drm_candidates[0]}"
fi

if [ -n "$primary" ]; then
    read -r kind card render <<< "$primary"
    if confirm "Use the $(gpu_label "$kind") GPU for video, Vulkan and Chromium?" y; then
        compose_files="$compose_files:hardware/gpu.yml"
        env_set CLIBOX_GPU_CARD "$card"
        env_set CLIBOX_GPU_RENDER "$render"
        if [ "$kind" = amd ] && [ -e "$DEV_ROOT/dev/kfd" ] \
            && confirm "Also pass /dev/kfd for ROCm/OpenCL compute?" y; then
            compose_files="$compose_files:hardware/amd-compute.yml"
        fi

        for gpu in "${gpus[@]}"; do
            [ "$gpu" = "$primary" ] && continue
            read -r kind2 card2 render2 <<< "$gpu"
            [ "$kind2" = nvidia ] && continue
            if confirm "Also pass the $(gpu_label "$kind2") GPU at $card2 as a second GPU?" n; then
                compose_files="$compose_files:hardware/gpu-secondary.yml"
                env_set CLIBOX_GPU2_CARD "$card2"
                env_set CLIBOX_GPU2_RENDER "$render2"
                break
            fi
        done
    fi
fi

if [ "$nvidia_seen" -eq 1 ]; then
    if [ "$DRY_RUN" -eq 1 ] || nvidia_runtime_ready; then
        if confirm "Pass the NVIDIA GPU through (NVIDIA Container Toolkit)?" y; then
            compose_files="$compose_files:hardware/nvidia.yml"
        fi
    else
        say "NVIDIA GPU found, but Docker has no nvidia runtime. Install the NVIDIA"
        say "Container Toolkit, then re-run this installer:"
        say "  https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html"
    fi
fi

[ "${#gpus[@]}" -gt 0 ] || say "No GPU found: CLIBox will use software rendering."

env_set COMPOSE_FILE "$compose_files"

if [ "$DRY_RUN" -eq 1 ]; then
    step "Dry run: .env would be"
    cat "$ENV_DRAFT"
    exit 0
fi

if [ -f "$ENV_FILE" ] && ! cmp -s "$ENV_FILE" "$ENV_DRAFT"; then
    cp "$ENV_FILE" "$ENV_FILE.bak.$(date +%Y%m%d%H%M%S)"
fi
cp "$ENV_DRAFT" "$ENV_FILE"
chmod 600 "$ENV_FILE"
say "Wrote $ENV_FILE"

cd "$INSTALL_DIR"
mkdir -p "$home_dir" "$workspace_dir"

if [ "$START" -eq 0 ]; then
    say "Start it with: cd $INSTALL_DIR && docker compose up -d"
    exit 0
fi

step "Starting CLIBox"
# Uses the published image when it can be pulled, and builds it from this
# source tree otherwise (no release yet, a private image, or no network).
if docker compose pull --quiet 2>/dev/null; then
    docker compose up -d
else
    say "The published image is not available; building it here (this takes a while)."
    docker compose up -d --build
fi

url_host="localhost"
[ "$host_bind" = "0.0.0.0" ] && url_host="$(hostname -I 2>/dev/null | awk '{print $1}')"
for _ in $(seq 1 60); do
    if curl -fsS -o /dev/null "http://127.0.0.1:$host_port" 2>/dev/null; then
        step "CLIBox is running at http://${url_host:-localhost}:$host_port"
        exit 0
    fi
    sleep 2
done
say "CLIBox has not answered yet. Check the logs with: cd $INSTALL_DIR && docker compose logs -f"
