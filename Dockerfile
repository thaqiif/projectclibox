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
RUN useradd --create-home --shell /bin/bash --uid 1001 agent \
    && mkdir -p \
        /home/agent/.cliweb \
        /home/agent/.config \
        /home/agent/.local/bin \
        /home/agent/.local/lib \
        /home/agent/.cache \
        /home/agent/.gitstate \
        /home/agent/.ssh \
        /home/agent/brew \
        /workspaces \
    && chmod 700 /home/agent/.ssh \
    && chown -R agent:agent /home/agent

ENV HOME=/home/agent \
    CLIWEB_HOME=/home/agent/.cliweb \
    CLIWEB_PORT=3011 \
    DB_PATH=/home/agent/.cliweb/cliweb.db \
    CLIWEB_BREW_PREFIX=/home/agent/brew \
    CLIWEB_BREW_SOURCE=/opt/cliweb-brew \
    NODE_ENV=production \
    NPM_CONFIG_PREFIX=/home/agent/.local \
    PIP_USER=1 \
    PYTHONUSERBASE=/home/agent/.local \
    PATH=/home/agent/brew/bin:/home/agent/brew/sbin:/home/agent/.local/bin:/home/agent/.local/sbin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin \
    GIT_CONFIG_GLOBAL=/home/agent/.gitstate/config \
    PUID=1000 \
    PGID=1000

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

WORKDIR /opt/agent-os
EXPOSE 3011
ENTRYPOINT ["docker-entrypoint.sh"]
