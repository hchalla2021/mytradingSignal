#!/bin/bash
# Start only OpeningEdge; leave healthy instances and other PM2 apps alone.
set -euo pipefail

PROJECT_PATH="${PROJECT_PATH:-/var/www/mytradingSignal}"
NAME="${OPENINGEDGE_PM2_NAME:-openingedge}"
VENV_BIN="${OPENINGEDGE_VENV_BIN:-$PROJECT_PATH/backend/venv/bin}"
PORT=8012

log() { echo "OpeningEdge: $1"; }

for tool in pm2 curl python3; do
    command -v "$tool" >/dev/null || { log "ERROR: $tool is unavailable."; exit 1; }
done
if [ ! -f "$PROJECT_PATH/openingedge/main.py" ] || [ ! -x "$VENV_BIN/uvicorn" ]; then
    log "ERROR: OpeningEdge source or $VENV_BIN/uvicorn is missing."
    exit 1
fi
if ! "$VENV_BIN/python" -c "import fastapi, uvicorn, kiteconnect; from zoneinfo import ZoneInfo; ZoneInfo('Asia/Kolkata')"; then
    log "ERROR: install OpeningEdge requirements in $VENV_BIN before starting."
    exit 1
fi

status=$(pm2 jlist | NAME="$NAME" PROJECT_PATH="$PROJECT_PATH" python3 -c '
import json, os, sys
apps = [p for p in json.load(sys.stdin) if p.get("name") == os.environ["NAME"]]
if len(apps) > 1:
    sys.exit("Multiple OpeningEdge PM2 entries; inspect before continuing.")
if not apps:
    print("missing")
else:
    env = apps[0]["pm2_env"]
    args = env.get("args", [])
    if isinstance(args, str):
        args = args.split()
    if env.get("pm_cwd") != os.environ["PROJECT_PATH"] or "openingedge.main:app" not in args:
        sys.exit("PM2 name belongs to a different command; refusing to restart it.")
    print(env["status"])
')

case "$status" in
    online)
        log "Already online; leaving its feed and approval unchanged." ;;
    missing)
        if curl -fsS -m 5 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
            log "ERROR: port $PORT already serves an unmanaged application; inspect it first."
            exit 1
        fi
        pm2 start "$VENV_BIN/uvicorn" --name "$NAME" --interpreter none --cwd "$PROJECT_PATH" \
            -- openingedge.main:app --host 127.0.0.1 --port "$PORT" ;;
    stopped|errored)
        pm2 restart "$NAME" ;;
    *)
        log "ERROR: unexpected PM2 state '$status'; inspect it first."
        exit 1 ;;
esac

for _ in $(seq 1 20); do
    if curl -fsS -m 5 "http://127.0.0.1:$PORT/api/status" | python3 -c '
import json, sys
s = json.load(sys.stdin)
sys.exit(0 if type(s.get("automation_on")) is bool and s.get("execution_status") == "LOCKED" else 1)
' 2>/dev/null; then
        pm2 save
        log "Status API ready; approval switch available. Live orders remain LOCKED."
        exit 0
    fi
    sleep 3
done
log "ERROR: status API is not ready. Inspect pm2 logs $NAME --lines 40 --nostream."
exit 1
