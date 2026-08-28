# Minimal CLIWeb workspace image
#
# The image contains the web UI and a useful, non-root shell environment. It
# deliberately does not install an AI coding CLI, harness, autopilot workflow,
# browser bundle, Docker client, or Docker socket. Install tools from the web
# terminal as needed; user-local installs live in the persisted home volume.

FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
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
        tmux \
        unzip \
        util-linux \
    && rm -rf /var/lib/apt/lists/*

# Keep a known-good Homebrew source snapshot in the image. The entrypoint
# copies it into the persistent home volume on first start.
RUN git clone --depth=1 https://github.com/Homebrew/brew.git /opt/cliweb-brew

# Build the UI into /opt so the persisted home volume never masks build
# artifacts when the image is rebuilt.
ENV CLIWEB_REPO=/opt/agent-os
COPY agent-os/ "${CLIWEB_REPO}"/
RUN cd "${CLIWEB_REPO}" \
    && npm install --legacy-peer-deps \
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
        /home/cliweb/brew \
        /home/linuxbrew \
        /workspaces \
    && chmod 700 /home/cliweb/.ssh \
    && chown -R cliweb:cliweb /home/cliweb \
    && ln -s /home/cliweb/brew /home/linuxbrew/.linuxbrew \
    && ln -s /home/cliweb/brew/bin/brew /usr/local/bin/brew

ENV HOME=/home/cliweb \
    CLIWEB_HOME=/home/cliweb/.cliweb \
    CLIWEB_PORT=3011 \
    DB_PATH=/home/cliweb/.cliweb/cliweb.db \
    CLIWEB_BREW_PREFIX=/home/cliweb/brew \
    CLIWEB_BREW_SOURCE=/opt/cliweb-brew \
    HOMEBREW_PREFIX=/home/linuxbrew/.linuxbrew \
    HOMEBREW_REPOSITORY=/home/linuxbrew/.linuxbrew \
    HOMEBREW_CACHE=/home/cliweb/.cache/Homebrew \
    NODE_ENV=production \
    NPM_CONFIG_PREFIX=/home/cliweb/.local \
    PIP_USER=1 \
    PYTHONUSERBASE=/home/cliweb/.local \
    PATH=/home/linuxbrew/.linuxbrew/bin:/home/cliweb/brew/bin:/home/linuxbrew/.linuxbrew/sbin:/home/cliweb/brew/sbin:/home/cliweb/.local/bin:/home/cliweb/.local/sbin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin \
    GIT_CONFIG_GLOBAL=/home/cliweb/.gitstate/config \
    PUID=1000 \
    PGID=1000

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY docker-brew-bootstrap.sh /usr/local/libexec/cliweb-brew-bootstrap
RUN chmod +x \
    /usr/local/bin/docker-entrypoint.sh \
    /usr/local/libexec/cliweb-brew-bootstrap

WORKDIR /opt/agent-os
EXPOSE 3011
ENTRYPOINT ["docker-entrypoint.sh"]
