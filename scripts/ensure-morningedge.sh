#!/bin/bash
# ============================================================
# Keep the read-only MorningEdge service running under PM2.
# ============================================================
# Idempotent: safe to run after every deploy, reboot or by the 9 AM timer.
# - Starts MorningEdge when it is missing from PM2.
# - Restarts it only when it is not online. A healthy instance is left alone
#   because it keeps today's pre-open ticks in memory and reloads the Zerodha
#   token from backend/.env by itself.
# - Saves the PM2 list only after /health answers, so reboots restore it.
#
#   bash scripts/ensure-morningedge.sh
#
# After a deploy that changes morningedge/, load the new code with
# `pm2 restart morningedge` before 09:00 or after 15:30 IST.
# ============================================================
set -euo pipefail

PROJECT_PATH="${PROJECT_PATH:-/var/www/mytradingSignal}"
NAME="${MORNINGEDGE_PM2_NAME:-morningedge}"
PORT="${MORNINGEDGE_PORT:-8010}"
VENV_BIN="${MORNINGEDGE_VENV_BIN:-$PROJECT_PATH/backend/venv/bin}"
APP_DIR="$PROJECT_PATH/morningedge"
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

log() { echo "[$(TZ=Asia/Kolkata date '+%Y-%m-%d %H:%M:%S IST')] MorningEdge: $1"; }

if [ ! -f "$APP_DIR/main.py" ] || [ ! -x "$VENV_BIN/uvicorn" ]; then
    log "ERROR: $APP_DIR/main.py or $VENV_BIN/uvicorn is missing."
    exit 1
fi
if ! "$VENV_BIN/python" -c "import fastapi, uvicorn, kiteconnect" 2>/dev/null; then
    log "ERROR: install dependencies: $VENV_BIN/pip install -r $APP_DIR/requirements.txt"
    exit 1
fi

status=$(pm2 jlist 2>/dev/null | NAME="$NAME" python3 -c "
import json, os, sys
try:
    for process in json.load(sys.stdin):
        if process.get('name') == os.environ['NAME']:
            print(process['pm2_env']['status']); break
    else:
        print('missing')
except Exception:
    print('unknown')
")

case "$status" in
    online)
        log "already online; leaving it running." ;;
    missing)
        log "not in PM2; starting on 127.0.0.1:$PORT."
        # --app-dir is required: backend/ also has a main.py.
        pm2 start "$VENV_BIN/uvicorn" --name "$NAME" --interpreter none --cwd "$APP_DIR" \
            -- main:app --app-dir "$APP_DIR" --host 127.0.0.1 --port "$PORT" ;;
    *)
        log "PM2 status is '$status'; restarting."
        pm2 restart "$NAME" ;;
esac

for _ in $(seq 1 20); do
    if curl -fsS -m 5 "http://127.0.0.1:$PORT/health" 2>/dev/null | grep -q '"service":"morningedge"'; then
        log "healthy on port $PORT."
        pm2 save >/dev/null
        exit 0
    fi
    sleep 3
done

log "ERROR: /health did not answer on port $PORT. Recent logs:"
pm2 logs "$NAME" --lines 40 --nostream || true
exit 1
