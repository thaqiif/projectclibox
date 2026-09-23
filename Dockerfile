# Minimal CLIWeb workspace image
#
# The image contains the web UI and a useful, non-root shell environment. It
# deliberately does not install an AI coding CLI, harness, autopilot workflow,
# browser automation framework, Docker client, or Docker socket. Install tools
# from the web terminal as needed; user-local installs live in the persisted
# home volume.

FROM node:22-trixie-slim

# Intel iGPU (VA-API/QSV) + AMD amdgpu (VA-API/VDPAU/Vulkan/OpenCL) + ffmpeg
# for hardware transcode on hosts with /dev/dri (e.g. HD 620 via iHD driver,
# AMD Raven Ridge and newer via radeonsi). vainfo/vulkaninfo/clinfo are kept
# for bring-up checks. /dev/kfd (mapped in compose) enables ROCm/OpenCL
# compute on AMD hosts; the full ROCm stack itself is intentionally not baked
# in — install it or use a ROCm-enabled tool (PyTorch ROCm, Ollama ROCm) when
# needed.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bash \
        build-essential \
        ca-certificates \
        chromium \
        chromium-sandbox \
        clinfo \
        curl \
        ffmpeg \
        file \
        git \
        gosu \
        intel-media-va-driver \
        jq \
        less \
        libdrm-amdgpu1 \
        libva-drm2 \
        libva2 \
        libvpl2 \
        mesa-opencl-icd \
        mesa-va-drivers \
        mesa-vdpau-drivers \
        mesa-vulkan-drivers \
        openssh-client \
        procps \
        python3 \
        python3-pip \
        python3-venv \
        radeontop \
        ripgrep \
        ruby-full \
        tmux \
        unzip \
        util-linux \
        vainfo \
        vulkan-tools \
    && test -x /usr/bin/chromium \
    && test -u /usr/lib/chromium/chrome-sandbox \
    && rm -rf /var/lib/apt/lists/*

# nanobrew publishes verified architecture-specific Linux release tarballs.
# Its Linux integration uses the fixed /opt/nanobrew data tree, which is
# mounted from the persistent CLIWeb host directory below.
ARG NANOBREW_VERSION=0.1.208
ARG TARGETARCH
RUN set -eux; \
    case "${TARGETARCH:-amd64}" in \
        amd64) \
            nanobrew_arch="x86_64"; \
            nanobrew_sha="de31e7768cb2f875cfa3a1e962e8d57761f81a1bd4f34a3f0e8f993005028cb4"; \
            ;; \
        arm64) \
            nanobrew_arch="aarch64"; \
            nanobrew_sha="a5be2e0884e1880e7fa4b1805c1d28328692d9ff720e20eabb809b1f9af9e2e8"; \
            ;; \
        *) \
            echo "Unsupported nanobrew target architecture: ${TARGETARCH}" >&2; \
            exit 1; \
            ;; \
    esac; \
    nanobrew_url="https://github.com/justrach/nanobrew/releases/download/v${NANOBREW_VERSION}/nb-${nanobrew_arch}-linux.tar.gz"; \
    curl -fsSL --retry 3 "${nanobrew_url}" -o /tmp/nanobrew.tar.gz; \
    echo "${nanobrew_sha}  /tmp/nanobrew.tar.gz" | sha256sum -c -; \
    tar -xzf /tmp/nanobrew.tar.gz -C /tmp; \
    install -m 0755 /tmp/nb /usr/local/bin/nb; \
    rm -f /tmp/nanobrew.tar.gz /tmp/nb /tmp/._nb

# Build the UI into /opt so the persisted home volume never masks build
# artifacts when the image is rebuilt.
ENV CLIWEB_REPO=/opt/cliweb
COPY cliweb/ "${CLIWEB_REPO}"/
# npm ci + --include=dev: a plain `npm install` can drop devDependencies such
# as @tailwindcss/postcss, which breaks `next build` with unresolved module
# errors. ci is deterministic from the lockfile and include=dev guards against
# production-flavored npm environments during the build.
RUN cd "${CLIWEB_REPO}" \
    && npm ci --include=dev --legacy-peer-deps \
    && npm run build \
    && npm cache clean --force

# Runtime user. The entrypoint remaps this user to PUID/PGID so files created
# in a host-mounted workspace have the host user's ownership.
RUN useradd --create-home --home-dir /home/cliweb --shell /bin/bash --uid 1001 cliweb \
    && mkdir -p \
        /home/cliweb/.cliweb \
        /home/cliweb/.config \
        /home/cliweb/.local/bin \
        /home/cliweb/.local/lib \
        /home/cliweb/.cache \
        /home/cliweb/.gitstate \
        /home/cliweb/.ssh \
        /opt/nanobrew \
        /workspaces \
    && chmod 700 /home/cliweb/.ssh \
    && chown -R cliweb:cliweb /home/cliweb /opt/nanobrew

ENV HOME=/home/cliweb \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    CLIWEB_HOME=/home/cliweb/.cliweb \
    CLIWEB_PORT=3011 \
    DB_PATH=/home/cliweb/.cliweb/cliweb.db \
    CLIWEB_NANOBREW_ROOT=/opt/nanobrew \
    CLIWEB_NANOBREW_BIN=/usr/local/bin/nb \
    CHROMIUM_PATH=/usr/bin/chromium \
    NANOBREW_NO_TELEMETRY=1 \
    NODE_ENV=production \
    NPM_CONFIG_PREFIX=/home/cliweb/.local \
    NPM_CONFIG_USERCONFIG=/home/cliweb/.npmrc \
    PIP_USER=1 \
    PYTHONUSERBASE=/home/cliweb/.local \
    PATH=/opt/nanobrew/prefix/bin:/home/cliweb/.local/bin:/home/cliweb/.local/sbin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin \
    GIT_CONFIG_GLOBAL=/home/cliweb/.gitstate/config \
    PUID=1000 \
    PGID=1000

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY docker-nanobrew-bootstrap.sh /usr/local/libexec/cliweb-nanobrew-bootstrap
COPY docker-cliweb-persistent-env.sh /usr/local/libexec/cliweb-persistent-env

# Force Chromium onto the AMD GPU (RADV/Vulkan via ANGLE). Debian's
# launcher sources /etc/chromium.d/* before exec, so dropping a file
# there applies the flags to every chromium invocation — including
# $CHROMIUM_PATH. On hosts without Vulkan Chromium falls back to
# SwiftShader, matching stock behaviour.
COPY chromium-amd-gpu.conf /etc/chromium.d/amd-gpu

RUN chmod +x \
    /usr/local/bin/nb \
    /usr/local/bin/docker-entrypoint.sh \
    /usr/local/libexec/cliweb-nanobrew-bootstrap \
    /usr/local/libexec/cliweb-persistent-env

WORKDIR /opt/cliweb
EXPOSE 3011
ENTRYPOINT ["docker-entrypoint.sh"]
