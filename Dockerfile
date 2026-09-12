# syntax=docker/dockerfile:1
# ProjectCliBox v2: Rust control plane + static React bundle.
# Node and npm exist only in the build stage; the final image has no Next.js
# server, Node runtime, or managed tmux dependency.

FROM node:22-trixie-slim@sha256:7b8a0c89c54499bee567618f96578e1a12a800f062fbdbfd1fb6a443fa6f6284 AS web-build
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --include=dev
COPY frontend/ ./
RUN npm run build

FROM rust:1.89-bookworm@sha256:948f9b08a66e7fe01b03a98ef1c7568292e07ec2e4fe90d88c07bb14563c84ff AS rust-build
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY rust/ ./rust/
RUN cargo build --release --locked -p projectclibox

FROM debian:bookworm-slim@sha256:88200866dfff7ea7f5cbcb6ec7c8a701889efe6fe859fe64d6990e4b07ea4171

# debian:bookworm-slim omits the CA bundle. Bootstrap HTTPS for the pinned
# Debian snapshot from the already-pinned Rust build stage before installing
# ca-certificates from that snapshot.
COPY --from=rust-build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt

ARG DEBIAN_SNAPSHOT=20250601T000000Z
RUN set -eux; \
    rm -f /etc/apt/sources.list /etc/apt/sources.list.d/debian.sources; \
    printf '%s\n' \
        "deb [check-valid-until=no] https://snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT}/ bookworm main" \
        "deb [check-valid-until=no] https://snapshot.debian.org/archive/debian-security/${DEBIAN_SNAPSHOT}/ bookworm-security main" \
        > /etc/apt/sources.list; \
    apt-get -o Acquire::Check-Valid-Until=false update; \
    apt-get install -y --no-install-recommends \
        bash \
        build-essential \
        ca-certificates \
        curl \
        file \
        git \
        gosu \
        jq \
        less \
        openssh-client \
        procps \
        python3 \
        python3-pip \
        python3-venv \
        ripgrep \
        ruby-full \
        tmux \
        unzip \
        util-linux \
    && rm -rf /var/lib/apt/lists/*

# nanobrew is an optional, persistent developer-tool extension point. It is
# not used to supervise terminals; the Rust runtime owns every PTY directly.
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
        /opt/projectclibox/frontend/dist \
        /workspaces \
    && chmod 700 /home/cliweb/.ssh \
    && chown -R cliweb:cliweb /home/cliweb /opt/nanobrew /opt/projectclibox /workspaces

COPY --from=rust-build /src/target/release/projectclibox /usr/local/bin/projectclibox
COPY --from=web-build /src/frontend/dist/ /opt/projectclibox/frontend/dist/

ENV HOME=/home/cliweb \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    CLIWEB_HOME=/home/cliweb/.cliweb \
    DB_PATH=/home/cliweb/.cliweb/projectclibox.db \
    PCLX_BIND=0.0.0.0 \
    PCLX_PORT=3011 \
    PCLX_STATIC_DIR=/opt/projectclibox/frontend/dist \
    PCLX_WORKSPACE_ROOT=/workspaces \
    CLIWEB_NANOBREW_ROOT=/opt/nanobrew \
    CLIWEB_NANOBREW_BIN=/usr/local/bin/nb \
    NANOBREW_NO_TELEMETRY=1 \
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
RUN chmod +x \
    /usr/local/bin/projectclibox \
    /usr/local/bin/docker-entrypoint.sh \
    /usr/local/libexec/cliweb-nanobrew-bootstrap \
    /usr/local/libexec/cliweb-persistent-env

WORKDIR /workspaces
EXPOSE 3011
ENTRYPOINT ["docker-entrypoint.sh"]
