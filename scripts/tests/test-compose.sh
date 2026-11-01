#!/usr/bin/env bash
set -eu

if [[ "${1:-}" == "--case" ]]; then
    mode="$2"
    installed=0
    downloads=0
    command_used=""
    helper="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/ensure-docker-compose.sh"
    docker() {
        if [[ "$*" == "compose version" ]]; then
            [[ "$mode" == "plugin" || "$mode" == "both" ]]
        else
            command_used="plugin"
        fi
    }
    docker-compose() {
        if [[ "$*" == "version" ]]; then
            [[ "$mode" == "standalone" || "$mode" == "both" || ( "$installed" == 1 && "$mode" != "bad-binary" ) ]]
        else
            command_used="standalone"
        fi
    }
    mktemp() { printf '%s\n' "mock-compose-download"; }
    uname() { printf '%s\n' "mock-linux"; }
    rm() { :; }
    curl() {
        downloads=$((downloads + 1))
        [[ "$*" == *"/docker/compose/releases/latest/download/docker-compose-mock-linux-mock-linux"* ]]
        [[ "$mode" != "download-failure" ]]
    }
    install() {
        [[ "$mode" != "install-failure" ]] || return 1
        installed=1
    }
    source "$helper"
    "${COMPOSE[@]}" -f docker-compose.prod.yml config --quiet
    if [[ "$mode" == "plugin" || "$mode" == "both" ]]; then
        [[ "$command_used" == "plugin" && "$downloads" == 0 ]]
    elif [[ "$mode" == "standalone" ]]; then
        [[ "$command_used" == "standalone" && "$downloads" == 0 ]]
    else
        [[ "$mode" == "docker-only" && "$installed" == 1 && "$downloads" == 1 && "$command_used" == "standalone" ]]
    fi
    exit 0
fi

for mode in plugin standalone both docker-only download-failure install-failure bad-binary; do
    if "$BASH" "$0" --case "$mode"; then
        case "$mode" in *failure|bad-binary) echo "FAIL: $mode was accepted"; exit 1;; esac
    else
        case "$mode" in *failure|bad-binary) ;; *) echo "FAIL: $mode"; exit 1;; esac
    fi
    echo "PASS: $mode"
done
echo '7 Compose selection/installation tests passed; Docker, downloads and writes are mocked.'
