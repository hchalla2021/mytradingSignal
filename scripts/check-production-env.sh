#!/usr/bin/env bash
# Server-side production settings check, run before containers are rebuilt.
# Prints key names, public IPs and pass/fail only; secret values are never echoed.
set -eu

env_file="${1:-${BACKEND_ENV_FILE:-backend/.env}}"
failures=0

fail() { echo "ERROR: $*" >&2; failures=$((failures + 1)); }
warn() { echo "WARNING: $*" >&2; }

if [ ! -f "$env_file" ]; then
    echo "ERROR: $env_file is missing on this server. Create it here (template: backend/.env.production.example in the repository)." >&2
    exit 1
fi

setting() {
    sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$env_file" | tail -n 1 | tr -d '\r' |
        sed -e 's/[[:space:]]#.*$//' -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

enabled() {
    case "$(setting "$1" | tr '[:upper:]' '[:lower:]')" in
        true|1|yes|on|t|y) return 0 ;;
        *) return 1 ;;
    esac
}

# docker-compose.prod.yml overrides all four values below with production-safe
# settings, so localhost values in a shared development .env are harmless at runtime.
for key in FRONTEND_URL REDIRECT_URL; do
    url="$(setting "$key")"
    case "$url" in
        "") ;;
        *localhost*|*127.0.0.1*|*0.0.0.0*) warn "$key is local in $env_file; docker-compose.prod.yml overrides it for production" ;;
        https://*) ;;
        *) warn "$key is not https; owner login and Kite redirect expect the public https URL" ;;
    esac
done

cors="$(setting CORS_ORIGINS)"
if [ -n "$cors" ]; then
    case "$cors" in
        *localhost*|*127.0.0.1*|*0.0.0.0*) warn "CORS_ORIGINS is local in $env_file; docker-compose.prod.yml overrides it for production" ;;
    esac
fi
if enabled DEBUG; then
    warn "DEBUG is true in $env_file; docker-compose.prod.yml overrides it with DEBUG=false"
fi

if enabled LIVE_TRADE_ENABLED; then
    if [ -n "$(setting FORCE_OUTBOUND_IPV4)" ] && ! enabled FORCE_OUTBOUND_IPV4; then
        warn "FORCE_OUTBOUND_IPV4 is not true; Auto Trade ON preflight will be refused"
    fi
    # docker-compose.prod.yml always forces production mode.
    expected="$(setting LIVE_STATIC_IP)"
    actual="$(curl -4 -fsS --max-time 8 https://api.ipify.org 2>/dev/null || true)"
    if [ -z "$expected" ]; then
        warn "LIVE_STATIC_IP is not set; the server IP cannot be verified"
    elif [ -z "$actual" ]; then
        warn "Could not read this server's outbound IPv4; verify it before market hours"
    elif [ "$actual" != "$expected" ]; then
        warn "Outbound IPv4 $actual does not match LIVE_STATIC_IP $expected; Auto Trade ON will be refused"
    else
        echo "AQTE static IP matches this server's outbound IPv4 ($actual); it must also be in the Kite IP whitelist."
    fi
    if enabled AQTE_LIVE_ALLOW_UNVALIDATED_RULES; then
        echo "AQTE entry mode: unvalidated rules (fully aligned setups can place real one-lot orders)."
    else
        echo "AQTE entry mode: strict (Auto Trade ON scans but places no orders)."
    fi
else
    echo "Live trading disabled (LIVE_TRADE_ENABLED is not true)."
fi

if [ "$failures" -ne 0 ]; then
    echo "Fix $env_file on the server before deploying." >&2
    exit 1
fi
echo "Production settings check passed."
