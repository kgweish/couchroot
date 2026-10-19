# Host-only native regression fixtures; separate from the pinned TV toolchain.
FROM python:3.12-slim-bookworm
RUN apt-get update -qq && apt-get install -y --no-install-recommends \
    gcc libc6-dev libjson-c5 openssl procps util-linux && \
    rm -rf /var/lib/apt/lists/*
WORKDIR /src
