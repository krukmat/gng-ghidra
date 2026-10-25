# A063 local-only MAME 0.289 build image. Build context is THIS DIRECTORY.
# No repo, ROMs, traces, tokens, compiled binaries or credentials enter the image.
FROM --platform=linux/arm64 node:22-bookworm-slim AS node-runtime
FROM --platform=linux/arm64 ubuntu:24.04
ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates git make build-essential python3 python3-venv \
    libsdl2-dev libsdl2-ttf-dev libfontconfig-dev libpulse-dev \
    qt6-base-dev qt6-base-dev-tools qtchooser \
    libxi-dev libxinerama-dev libasound2-dev pkg-config \
    binutils file bash coreutils xvfb xauth \
    && rm -rf /var/lib/apt/lists/*
COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/node
RUN node --version && python3 --version && gcc --version | head -n 1
ENV PYTHONDONTWRITEBYTECODE=1
WORKDIR /workspace
