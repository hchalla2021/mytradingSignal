#!/bin/bash
# ============================================================
# BACKEND CRASH DIAGNOSTIC - run on the droplet:
#   cd /var/www/mytradingSignal && git pull && bash scripts/diagnose-backend-crash.sh
# Prints everything needed to find why backend keeps stopping.
# ============================================================
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

echo "############ 1. PM2 PROCESS CONFIG (how backend is launched) ############"
pm2 describe backend 2>/dev/null | grep -E "script|exec|interpreter|cwd|error log|out log|restarts|status|created" || echo "no 'backend' process in pm2"

echo ""
echo "############ 2. LAST 60 LINES OF BACKEND ERROR LOG ############"
ERRLOG=$(pm2 describe backend 2>/dev/null | grep "error log path" | awk -F'│' '{print $3}' | xargs)
[ -z "$ERRLOG" ] && ERRLOG="/root/.pm2/logs/backend-error.log"
echo "(log file: $ERRLOG)"
tail -n 60 "$ERRLOG" 2>/dev/null || echo "error log not found"

echo ""
echo "############ 3. LAST 30 LINES OF BACKEND OUT LOG ############"
OUTLOG="/root/.pm2/logs/backend-out.log"
tail -n 30 "$OUTLOG" 2>/dev/null || echo "out log not found"

echo ""
echo "############ 4. PORT 8000 - WHO IS HOLDING IT ############"
ss -ltnp | grep ':8000 ' || echo "port 8000 is FREE"

echo ""
echo "############ 5. PYTHON / VENV SANITY ############"
if [ -f /var/www/mytradingSignal/backend/venv/bin/python ]; then
    PY=/var/www/mytradingSignal/backend/venv/bin/python
elif [ -f /var/www/mytradingSignal/.venv/bin/python ]; then
    PY=/var/www/mytradingSignal/.venv/bin/python
else
    PY=$(command -v python3)
fi
echo "python: $PY"
"$PY" --version 2>&1
echo "--- import test (catches missing modules / syntax errors after git pull) ---"
cd /var/www/mytradingSignal/backend 2>/dev/null && timeout 60 "$PY" -c "import main; print('IMPORT OK')" 2>&1 | tail -n 15

echo ""
echo "############ 6. MEMORY / DISK (OOM killer check) ############"
free -m | head -2
df -h / | tail -1
echo "--- kernel OOM kills (last 5) ---"
dmesg -T 2>/dev/null | grep -i "killed process" | tail -5 || journalctl -k --since "24 hours ago" 2>/dev/null | grep -i "oom\|killed process" | tail -5 || echo "no OOM events found"

echo ""
echo "############ 7. .ENV PRESENT? ############"
ls -la /var/www/mytradingSignal/backend/.env 2>/dev/null || echo "backend/.env MISSING!"

echo ""
echo "############ DONE - paste ALL output above ############"
