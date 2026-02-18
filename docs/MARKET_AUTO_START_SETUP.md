# Market Auto-Start System Setup Guide

## Overview
This centralized scheduler automatically starts your backend at 9 AM on trading days (excluding weekends and NSE/BSE holidays).

**What It Does:**
- ✅ Checks at 9:00 AM every market day
- ✅ Automatically starts backend via PM2
- ✅ Monitors backend health during market hours
- ✅ Auto-restarts if backend crashes
- ✅ Logs all actions for debugging
- ✅ Handles pre-open (9:00-9:15) and live trading (9:15-3:30) periods

---

## Installation on DigitalOcean Server

### Step 1: Prerequisites
Make sure you have PM2 and node-cron installed:

```bash
cd /var/www/mytradingSignal

# Install node-cron if not already installed
npm install node-cron
```

### Step 2: Deploy the Scheduler Script
Copy `market-auto-start.js` to your server:

```bash
# If using SCP from your local machine:
scp market-auto-start.js root@your_server_ip:/var/www/mytradingSignal/

# Or create it directly on server:
nano /var/www/mytradingSignal/market-auto-start.js
# (paste the content)
```

### Step 3: Create Log Directory
```bash
mkdir -p /var/log/mytradingSignal
chmod 755 /var/log/mytradingSignal
```

### Step 4: Start the Scheduler with PM2
```bash
cd /var/www/mytradingSignal
pm2 start market-auto-start.js --name "market-scheduler"
```

### Step 5: Save PM2 Configuration
```bash
pm2 save
pm2 startup
```

This ensures the scheduler restarts automatically when your server reboots.

### Step 6: Verify It's Running
```bash
pm2 list
pm2 logs market-scheduler
```

---

## How It Works

### Timeline During Market Days (Mon-Fri)

```
9:00 AM ─────────────────────────────────────────── 3:30 PM
│
├─ 9:00-9:15 AM: PRE-OPEN PERIOD
│  ├─ Scheduler checks if backend is running
│  ├─ If not running → AUTO-STARTS backend
│  └─ All values frozen (no live market data)
│
├─ 9:15-3:30 PM: LIVE TRADING PERIOD
│  ├─ Backend is already running
│  ├─ WebSocket receives live market data
│  ├─ Health checks every 10 minutes
│  └─ Auto-restarts if backend crashes
│
└─ 3:30 PM: MARKET CLOSE
   └─ Values freeze, WebSocket closes
```

### Market Days Check
- **Only runs on**: Monday to Friday
- **Excludes**: Weekends, NSE/BSE holidays
- **Timezone**: India Standard Time (IST / UTC+5:30)

### Holidays (2026-2027)
The script includes all NSE/BSE holidays:
- Republic Day (26 Jan)
- Holi, Good Friday, Dussehra, Diwali
- Independence Day, Gandhi Jayanti, etc.

**Update**: Before next year, update the `MARKET_HOLIDAYS_2028` array in the script.

---

## Monitoring & Debugging

### Check Scheduler Status
```bash
pm2 status market-scheduler
pm2 logs market-scheduler               # Live logs
pm2 logs market-scheduler --lines 50    # Last 50 lines
pm2 logs market-scheduler --err         # Error logs only
```

### View Detailed Logs
```bash
# Main activity log
tail -f /var/log/mytradingSignal/market-scheduler.log

# Error log
tail -f /var/log/mytradingSignal/market-scheduler-error.log

# Combined
tail -f /var/log/mytradingSignal/market-scheduler*.log
```

### Test at 8:55 AM
Around 8:55 AM, you should see in logs:
```
🕐 Market Scheduler Check - <time>
=== MARKET DAY & TRADING HOURS ===
🟠 PRE-OPEN PERIOD (9:00-9:15): Values frozen
🚀 Starting backend...
✅ Backend started successfully
```

### Manual Testing (Any Time)
```bash
# Simulate checking backend status
pm2 describe market-scheduler

# Force reload scheduler
pm2 restart market-scheduler

# Check if backend is running
pm2 list | grep backend
```

---

## Troubleshooting

### Problem: Backend Not Starting
```bash
# Check if PM2 can find Python backend
pm2 logs market-scheduler

# Verify backend/main.py exists
ls -la /var/www/mytradingSignal/backend/main.py

# Check if Python is installed
python3 --version
```

### Problem: Health Check Failing
The script tries `http://localhost:8000/health` endpoint. Make sure:

1. Your FastAPI backend has a health endpoint:
```python
@app.get("/health")
async def health():
    return {"status": "ok"}
```

2. Backend listens on `0.0.0.0:8000` in prod

### Problem: Scheduler Not Running
```bash
# Restart the scheduler
pm2 restart market-scheduler

# Or kill and restart fresh
pm2 delete market-scheduler
pm2 start market-auto-start.js --name "market-scheduler"
pm2 save
```

### Problem: Wrong Timezone
Verify server timezone is IST:
```bash
timedatectl
# Should show: Asia/Kolkata
# If not, set it:
sudo timedatectl set-timezone Asia/Kolkata
```

---

## Configuration Options

Edit `market-auto-start.js` if you need to change:

```javascript
const CONFIG = {
  PROJECT_PATH: '/var/www/mytradingSignal',      // Your project path
  BACKEND_NAME: 'backend',                       // PM2 app name
  MARKET_OPEN_HOUR: 9,                           // 9 AM
  MARKET_OPEN_MINUTE: 0,
  PREOPEN_END_MINUTE: 15,                        // Until 9:15 AM
  MARKET_CLOSE_HOUR: 15,                         // 3 PM
  MARKET_CLOSE_MINUTE: 30,
  LOG_FILE: '/var/log/mytradingSignal/market-scheduler.log',
};
```

After editing, restart:
```bash
pm2 restart market-scheduler
```

---

## Advanced Features

### Health Check
Every 10 minutes during market hours, the script pings:
- `GET http://localhost:8000/health`
- If backend not responding → Auto-restart

### Log Rotation (Optional)
To prevent logs from getting too large, add to crontab:

```bash
crontab -e

# Add this line (rotate logs every Sunday at 2 AM)
0 2 * * 0 gzip /var/log/mytradingSignal/market-scheduler.log
```

### Email Alerts (Optional)
To get notified when backend fails to start:

```bash
# Install mail utility
sudo apt-get install mailutils

# Add to market-auto-start.js after startBackend() failure:
execSync(`echo "Backend failed to start at 9 AM" | mail -s "Trading Alert" your@email.com`);
```

---

## Uninstall/Remove

```bash
# Stop the scheduler
pm2 stop market-scheduler

# Completely remove
pm2 delete market-scheduler
pm2 save

# Remove from startup
pm2 unstartup

# Clean up logs
rm -rf /var/log/mytradingSignal/
```

---

## Support

If scheduler not working:
1. Check logs: `pm2 logs market-scheduler`
2. Verify timezone: `timedatectl`
3. Test manually: Run `pm2 start backend/main.py --name backend` to ensure backend starts
4. Check PM2 status: `pm2 status`

Once you confirm backend starts manually, the scheduler will handle it automatically.

