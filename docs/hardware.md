# Hardware passthrough

CLIBox's base `compose.yml` passes no host devices, so it runs on any Docker
host. Each piece of hardware is an overlay in [`hardware/`](../hardware),
switched on by listing it in `COMPOSE_FILE` in `.env`:

```ini
COMPOSE_FILE=compose.yml:hardware/kvm.yml:hardware/gpu.yml:hardware/amd-compute.yml
CLIBOX_GPU_CARD=/dev/dri/card1
CLIBOX_GPU_RENDER=/dev/dri/renderD129
```

`./install.sh` detects the host's devices and writes these lines for you.

| Overlay | Gives terminals | Host needs |
|---|---|---|
| `kvm.yml` | `/dev/kvm`: QEMU/KVM, Android emulators, microVMs | CPU virtualization, `kvm` module |
| `gpu.yml` | One Intel or AMD GPU as `card0`/`renderD128`: VA-API, QSV, Vulkan, OpenCL, GPU Chromium | `/dev/dri` |
| `gpu-secondary.yml` | A second DRM GPU as `card1`/`renderD129` | a second GPU |
| `amd-compute.yml` | `/dev/kfd` for ROCm/OpenCL compute | `amdgpu` |
| `nvidia.yml` | NVIDIA GPUs (CUDA, NVENC) | [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html) |

`CLIBOX_GPU_CARD`/`CLIBOX_GPU_RENDER` name the host nodes of the primary GPU
(`CLIBOX_GPU2_*` for the secondary). Find a GPU's nodes with:

```bash
for c in /sys/class/drm/card[0-9]; do
  echo "$c $(cat $c/device/vendor) $(ls $c/device/drm | grep renderD)"
done   # 0x1002 AMD, 0x8086 Intel, 0x10de NVIDIA, 0x1af4 virtio
```

Using a PaaS such as Coolify or Portainer that takes a single compose file?
Flatten your selection into one file with
`docker compose config > compose.local.yml` and deploy that.

## Hardware virtualization (KVM)

The container maps the host's `/dev/kvm` device through to the web terminals,
so you can run hardware-accelerated virtualization from a terminal—QEMU/KVM
guests, Android emulators, microVMs, or test suites that use KVM. Prerequisites
are on the **host**, not the container: your CPU must support virtualization
and the `kvm` module must be loaded.

```bash
ls -l /dev/kvm          # must exist; crw-rw---- root:kvm on most hosts
```

The entrypoint hands the device to the unprivileged `clibox` user
automatically, so terminals can use it without extra setup:

```bash
ls -l /dev/kvm          # inside the container: crw-rw---- clibox
```

KVM is off unless `hardware/kvm.yml` is in `COMPOSE_FILE`; `./install.sh`
adds it when the host has `/dev/kvm`. Hosts without it (macOS/Windows Docker
Desktop, or a VM without nested VT-x/AMD-V) simply leave it out.

## Intel and AMD GPUs

With `hardware/gpu.yml` (and, on AMD, `hardware/amd-compute.yml`) the
container gets the chosen GPU's `/dev/dri` nodes and `/dev/kfd` (ROCm/OpenCL
compute). The image installs `ffmpeg` +
Mesa userspace (`mesa-va-drivers`, `mesa-vdpau-drivers`,
`mesa-vulkan-drivers`, `mesa-opencl-icd`) alongside the Intel `iHD` driver,
so web terminals can use hardware accel without `--privileged`:

```bash
ls -l /dev/dri /dev/kfd           # inside: card*, renderD*, kfd — group clibox
vainfo --display drm --device /dev/dri/renderD128
vainfo --display drm --device /dev/dri/renderD129   # second GPU, if present
vulkaninfo --summary               # RADV on AMD, Intel Vulkan elsewhere
clinfo --short                     # Mesa OpenCL (Rusticl/Clover)
ffmpeg -hide_banner -hwaccels     # expect vaapi qsv drm vulkan opencl
radeontop                          # AMD utilization monitor
```

The entrypoint `chgrp clibox` + `chmod 660` every DRI node
(`/dev/dri/card*`, `/dev/dri/renderD*`) and `/dev/kfd` after the PUID/PGID
remap, so the non-root `clibox` user can open all GPUs even when host GIDs
(`video:44`, `render:992`) differ from the container. `group_add` is
intentionally not used — the final `setpriv --init-groups` would drop it.

AMD notes:

- VA-API uses the `radeonsi` driver (`radeonsi_drv_video.so`). Pick the
  render node that belongs to the AMD card and test encode, e.g.:
  ```bash
  ffmpeg -hide_banner -init_hw_device vaapi=va:/dev/dri/renderD129 \
    -f lavfi -i testsrc=size=1280x720:rate=30:duration=5 \
    -vf 'format=nv12,hwupload' -c:v h264_vaapi -f null -
  ```
- `/dev/kfd` is required for ROCm/OpenCL compute (PyTorch ROCm, Ollama
  ROCm, `clinfo`). The image ships the Mesa OpenCL ICD only; the full
  ROCm stack is intentionally not baked in — install it user-locally or
  use a ROCm-enabled tool when you need HIP/rocBLAS.
- On multi-GPU hosts (e.g. `virtio-gpu` + `amdgpu`) the installer makes the
  real GPU the primary one, so it is always `card0`/`renderD128` inside the
  container whatever its host number. A second GPU (`hardware/gpu-secondary.yml`)
  appears as `card1`/`renderD129`.

Intel notes (unchanged): HD 620-class capability is H264 encode +
H264/HEVC/VP9 decode; use `h264_qsv` / `h264_vaapi` (`hevc_qsv`,
`hevc_vaapi`, VP9/AV1 encode list but fail on that GPU).

If headless Chromium crashes on DRI, rerun that job with `--disable-gpu`.

## NVIDIA GPUs

`hardware/nvidia.yml` reserves every NVIDIA GPU through the NVIDIA Container
Toolkit (set `CLIBOX_NVIDIA_DEVICES` to a comma-separated list of indices or
UUIDs to limit it). Install the toolkit on the host and register it with
Docker first, then check from a terminal:

```bash
nvidia-smi
ffmpeg -hide_banner -encoders | grep nvenc
```

The image does not include CUDA; install the CUDA build of your tool (PyTorch,
Ollama, llama.cpp) from a terminal.

## Chromium

The image installs Debian's Chromium package and its sandbox helper with
the fixed runtime path `/usr/bin/chromium`, then exports it as
`CHROMIUM_PATH`. Debian resolves Chromium's runtime libraries as package
dependencies, including the trixie `libglib2.0-0t64` transition package. The
container's web process runs as the unprivileged `clibox` user. Use the same
user for ad-hoc commands instead of running Chromium as root:

```bash
# Confirm the image contains the expected Chromium binary and version.
docker compose exec --user clibox clibox sh -lc '"$CHROMIUM_PATH" --version'

# Render a page without a display and print its resulting HTML.
docker compose exec --user clibox clibox sh -lc '"$CHROMIUM_PATH" --headless=new --disable-dev-shm-usage --dump-dom https://example.com'
```

`--headless=new` is required in this display-less container. CLI tools
should point at `$CHROMIUM_PATH` (or the `chromium` command on `PATH`) rather
than downloading a second browser bundle.
`--disable-dev-shm-usage` is useful for pages that exceed Docker's default
shared-memory allocation. Keep the Chromium sandbox enabled: run it as the
unprivileged `clibox` user and do not add `--no-sandbox`. Rebuild the image
after changing the Dockerfile:

```bash
docker compose up -d --build
```

### GPU-accelerated Chromium

The image drops `/etc/chromium.d/amd-gpu`, which Debian's Chromium launcher
sources before every exec. It appends `--use-angle=vulkan
--enable-features=Vulkan` so WebGL/compositing runs on the AMD GPU (RADV)
instead of falling back to SwiftShader (CPU). Verify:

```bash
# Should report RADV PHOENIX, not SwiftShader.
docker compose exec --user clibox clibox sh -lc '
  tmp=$(mktemp -d)
  cat > "$tmp/p.html" <<HTML
<html><body><script>
const c=document.createElement("canvas");
const g=c.getContext("webgl2")||c.getContext("webgl");
const d=g&&g.getExtension("WEBGL_debug_renderer_info");
document.title=g?(d?g.getParameter(d.UNMASKED_RENDERER_WEBGL):g.getParameter(g.RENDERER)):"NO_WEBGL";
</script></body></html>
HTML
  "$CHROMIUM_PATH" --headless=new --no-sandbox --disable-dev-shm-usage \
    --virtual-time-budget=5000 --dump-dom "file://$tmp/p.html" \
    | grep -o "<title>[^<]*</title>"
  rm -rf "$tmp"
'
```

On hosts without a Vulkan device the flags are harmless — Chromium degrades
to SwiftShader, matching stock behaviour.
