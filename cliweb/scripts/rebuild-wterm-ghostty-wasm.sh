#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLIWEB_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
METADATA="$SCRIPT_DIR/wterm-ghostty-build.json"
WTERM_COMMIT="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).wtermSourceCommit' "$METADATA")"
ZIG_VERSION="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).zigVersion' "$METADATA")"
BUILD_IMAGE="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).buildImage' "$METADATA")"
EXPECTED_WASM="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).wasmSha256' "$METADATA")"

case "$(uname -m)" in
  x86_64)
    ZIG_ARCH="x86_64"
    PLATFORM="linux/amd64"
    ZIG_SHA256="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).zigLinuxX64Sha256' "$METADATA")"
    ;;
  aarch64 | arm64)
    ZIG_ARCH="aarch64"
    PLATFORM="linux/arm64"
    ZIG_SHA256="$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).zigLinuxArm64Sha256' "$METADATA")"
    ;;
  *)
    echo "Unsupported architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT
git clone --quiet --filter=blob:none --no-checkout https://github.com/vercel-labs/wterm.git "$TEMP_DIR/wterm"
git -C "$TEMP_DIR/wterm" checkout --quiet "$WTERM_COMMIT"
git -C "$TEMP_DIR/wterm" apply "$CLIWEB_DIR/patches/wterm-ghostty-resource-title.patch"

ZIG_DIR="zig-${ZIG_ARCH}-linux-${ZIG_VERSION}"
ZIG_ARCHIVE="$TEMP_DIR/zig.tar.xz"
curl -fsSL "https://ziglang.org/download/${ZIG_VERSION}/${ZIG_DIR}.tar.xz" -o "$ZIG_ARCHIVE"
printf '%s  %s\n' "$ZIG_SHA256" "$ZIG_ARCHIVE" | sha256sum --check --status

docker run --rm --platform "$PLATFORM" \
  -v "$TEMP_DIR/wterm:/work/wterm" \
  -v "$ZIG_ARCHIVE:/tmp/zig.tar.xz:ro" \
  -e ZIG_DIR="$ZIG_DIR" \
  -e WTERM_COMMIT="$WTERM_COMMIT" \
  "$BUILD_IMAGE" sh -euc '
    apk add --no-cache bash python3 xz >/dev/null
    tar -xJf /tmp/zig.tar.xz -C /tmp
    export PATH="/tmp/$ZIG_DIR:$PATH"
    test "$(git -C /work/wterm rev-parse HEAD)" = "$WTERM_COMMIT"
    cd /work/wterm/packages/@wterm/ghostty
    bash scripts/build-wasm.sh
  '

BUILT_WASM="$TEMP_DIR/wterm/packages/@wterm/ghostty/wasm/ghostty-vt.wasm"
ACTUAL_WASM="$(sha256sum "$BUILT_WASM" | awk '{print $1}')"
if [[ "$ACTUAL_WASM" != "$EXPECTED_WASM" ]]; then
  echo "Rebuilt WASM hash $ACTUAL_WASM does not match reviewed hash $EXPECTED_WASM" >&2
  exit 1
fi
cp "$BUILT_WASM" "$CLIWEB_DIR/public/ghostty-vt.wasm"
echo "Rebuilt and installed Ghostty WASM $ACTUAL_WASM"
