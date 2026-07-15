#!/bin/bash
# ============================================================
# ONE-TIME SETUP: Auto-start backend at 9:00 AM IST (Mon-Fri)
# ============================================================
# Installs an OS-level systemd timer on the DigitalOcean droplet.
# - Fires at exactly 09:00 Asia/Kolkata, Monday to Friday
# - Fully isolated: survives reboots, git deploys, pm2 crashes
# - Non-blocking: runs as a oneshot unit, touches nothing else
# - Persistent=true: if droplet was down at 9 AM, runs on boot
#
# Run ONCE on the droplet (as root):
#   cd /var/www/mytradingSignal
#   bash scripts/setup-9am-autostart.sh
# ============================================================
set -euo pipefail

LOG_DIR="/var/log/mytradingSignal"
START_SCRIPT="/usr/local/bin/market-9am-start.sh"

echo "[1/5] Creating log directory..."
mkdir -p "$LOG_DIR"

echo "[2/5] Installing start script -> $START_SCRIPT"
cat > "$START_SCRIPT" <<'EOF'
#!/bin/bash
# Auto-start trading backend (invoked by systemd timer at 9:00 AM IST Mon-Fri)
LOG="/var/log/mytradingSignal/market-9am-start.log"
PROJECT_PATH="/var/www/mytradingSignal"
BACKEND_NAME="backend"
BACKEND_PORT=8000
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

log() { echo "[$(TZ=Asia/Kolkata date '+%Y-%m-%d %H:%M:%S IST')] $1" >> "$LOG"; }

# Returns pm2 status of backend: online / stopped / errored / missing
backend_status() {
    pm2 jlist 2>/dev/null | python3 -c "
import sys, json
try:
    for p in json.load(sys.stdin):
        if p.get('name') == '$BACKEND_NAME':
            print(p['pm2_env']['status']); break
    else:
        print('missing')
except Exception:
    print('unknown')
" 2>/dev/null
}

# Kill any orphan process holding the backend port (stale uvicorn = crash loop)
free_backend_port() {
    local pids
    pids=$(ss -ltnp 2>/dev/null | grep ":$BACKEND_PORT " | grep -oP 'pid=\K[0-9]+' | sort -u)
    if [ -n "$pids" ]; then
        log "Killing stale process(es) on port $BACKEND_PORT: $pids"
        kill -9 $pids 2>/dev/null || true
        sleep 2
    fi
}

log "===== 9AM auto-start triggered ====="
cd "$PROJECT_PATH" || { log "ERROR: project path missing"; exit 1; }

# If pm2 daemon is dead (e.g., after reboot), resurrect saved processes first
if ! pm2 pid >/dev/null 2>&1 || [ -z "$(pm2 pid 2>/dev/null)" ]; then
    log "pm2 daemon not running - resurrecting saved processes"
    pm2 resurrect >> "$LOG" 2>&1 || true
fi

# Stop backend cleanly, then clear any orphan holding port 8000
# (known pitfall: stale uvicorn on port 8000 causes instant crash loop)
pm2 stop "$BACKEND_NAME" >> "$LOG" 2>&1 || true
sleep 2
free_backend_port

# Restart everything
pm2 restart all --update-env >> "$LOG" 2>&1 || pm2 resurrect >> "$LOG" 2>&1 || true

# Verify backend actually stays online; retry up to 3 times
for attempt in 1 2 3; do
    sleep 15
    STATUS=$(backend_status)
    log "Verify attempt $attempt: backend status = $STATUS"
    if [ "$STATUS" = "online" ]; then
        break
    fi
    log "Backend not online - capturing last errors:"
    tail -n 30 /root/.pm2/logs/${BACKEND_NAME}-error.log >> "$LOG" 2>/dev/null || true
    pm2 stop "$BACKEND_NAME" >> "$LOG" 2>&1 || true
    sleep 2
    free_backend_port
    pm2 restart "$BACKEND_NAME" --update-env >> "$LOG" 2>&1 || pm2 start "$BACKEND_NAME" >> "$LOG" 2>&1 || true
done

# Final health check on the API itself
sleep 5
if curl -sf -m 10 "http://127.0.0.1:$BACKEND_PORT/api/system/health" > /dev/null 2>&1 \
   || curl -sf -m 10 "http://127.0.0.1:$BACKEND_PORT/" > /dev/null 2>&1; then
    log "HEALTH CHECK: backend responding on port $BACKEND_PORT - OK"
else
    log "WARNING: backend not responding on port $BACKEND_PORT - status: $(backend_status)"
    pm2 list >> "$LOG" 2>&1 || true
fi

pm2 save >> "$LOG" 2>&1 || true
log "===== done ====="
EOF
chmod +x "$START_SCRIPT"

echo "[3/5] Installing systemd service + timer..."
cat > /etc/systemd/system/market-9am-start.service <<EOF
[Unit]
Description=Start trading backend (pm2 restart all) at 9AM IST
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=root
ExecStart=$START_SCRIPT
TimeoutStartSec=300
EOF

cat > /etc/systemd/system/market-9am-start.timer <<EOF
[Unit]
Description=Timer: 9:00 AM IST Monday-Friday backend auto-start

[Timer]
OnCalendar=Mon..Fri 09:00:00 Asia/Kolkata
Persistent=true
Unit=market-9am-start.service

[Install]
WantedBy=timers.target
EOF

echo "[4/5] Enabling timer..."
systemctl daemon-reload
systemctl enable --now market-9am-start.timer

echo "[5/5] Making pm2 survive reboots (startup + save)..."
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true
pm2 save || true

echo ""
echo "============================================================"
echo " DONE. Backend will auto-start at 9:00 AM IST, Mon-Fri."
echo "============================================================"
echo ""
echo "Next scheduled run:"
systemctl list-timers market-9am-start.timer --no-pager
echo ""
echo "Useful commands:"
echo "  systemctl list-timers market-9am-start.timer   # next run time"
echo "  systemctl start market-9am-start.service       # test it right now"
echo "  tail -f /var/log/mytradingSignal/market-9am-start.log"
