#!/usr/bin/env bash
# Source from deployment scripts after Docker is installed.
if docker compose version >/dev/null 2>&1; then
    COMPOSE=(docker compose)
elif docker-compose version >/dev/null 2>&1; then
    COMPOSE=(docker-compose)
else
    echo 'Installing Docker Compose...'
    compose_download="$(mktemp)"
    if ! curl -fLsS "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o "$compose_download"; then
        rm -f "$compose_download"
        echo 'Docker Compose download failed; deployment stopped.' >&2
        return 1
    fi
    if ! install -m 0755 "$compose_download" /usr/local/bin/docker-compose; then
        rm -f "$compose_download"
        echo 'Docker Compose installation failed; deployment stopped.' >&2
        return 1
    fi
    rm -f "$compose_download"
    docker-compose version
    COMPOSE=(docker-compose)
fi
