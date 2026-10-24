# ROM-free A0.6.3 diagnostic environment; no ROMs, tokens or emulator builds
# are included in the image.
FROM mcr.microsoft.com/devcontainers/cpp:ubuntu-24.04

ENV DEBIAN_FRONTEND=noninteractive

# Based on MAME 0.289's Debian/Ubuntu compilation prerequisites.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       ca-certificates git make build-essential python3 python3-venv \
       libsdl2-dev libsdl2-ttf-dev libfontconfig-dev libpulse-dev \
       qt6-base-dev qt6-base-dev-tools qtchooser \
       libxi-dev libxinerama-dev libasound2-dev pkg-config \
       binutils file \
    && rm -rf /var/lib/apt/lists/*
