# ⏰ Market Auto-Start System
## Automatic Backend Startup at 9 AM on Trading Days

**Problem Solved:** 
- ❌ Backend doesn't start at 9 AM → ✅ Auto-starts automatically
- ❌ Manual check & restart needed → ✅ Centralized monitoring
- ❌ Pre-open period confusion (9-9:15) → ✅ Clear timeline
- ❌ No visibility into when backend crashed → ✅ Health checks + logging

---

## 📋 What This Does

```
9:00 AM (IST) → Market Opens
│
├─ 9:00-9:15 AM: PRE-OPEN PERIOD
│  ├─ Scheduler checks if backend is running
│  ├─ If NOT running → AUTO-STARTS it
│  └─ All values frozen (no live market data)
│
├─ 9:15-3:30 PM: LIVE TRADING PERIOD
│  ├─ WebSocket receives live market data
│  ├─ Health checks every 10 minutes
│  └─ Auto-restarts if backend crashes
│
└─ 3:30 PM: MARKET CLOSES
   └─ Values freeze, WebSocket closes
```

**Key Benefits:**
- ✅ **Automatic**: No manual intervention needed
- ✅ **Smart**: Only runs on trading days (Monday-Friday, excluding holidays)
- ✅ **Reliable**: Health checks ensure backend stays up
- ✅ **Observable**: Complete logging for debugging
- ✅ **Centralized**: Single point of control for all monitoring

---

## 🚀 Quick Start (5 minutes)

### Prerequisites
- Node.js + npm installed
- PM2 installed: `npm install -g pm2`
- FSA backend at `/var/www/mytradingSignal/backend/`

### Step 1: Copy Files to Your Server

```bash
# Option A: Using SCP (from your local machine)
scp market-auto-start.js root@your-server-ip:/var/www/mytradingSignal/
scp setup-auto-start.sh root@your-server-ip:/var/www/mytradingSignal/

# Option B: Or create directly on server
ssh root@your-server-ip
cd /var/www/mytradingSignal
# (paste content of market-auto-start.js and setup-auto-start.sh)
```

### Step 2: Run Setup Script

```bash
ssh root@your-server-ip
cd /var/www/mytradingSignal
chmod +x setup-auto-start.sh
bash setup-auto-start.sh
```

This will:
- ✅ Install node-cron dependency
- ✅ Create log directory
- ✅ Start scheduler with PM2
- ✅ Configure PM2 startup on reboot

### Step 3: Verify It's Running

```bash
# Check scheduler status
pm2 status

# View logs
pm2 logs market-scheduler

# Check tomorrow at 8:55 AM IST - should auto-start backend
tail -f /var/log/mytradingSignal/market-scheduler.log
```

✅ **Done!** Backend will auto-start every market day at 9 AM.

---

## 📦 Files Included

### `market-auto-start.js`
**Node.js version** - Recommended if you prefer Node.js

Features:
- Uses `node-cron` for scheduling
- Minute-level monitoring
- Auto-restart on crash detection
- Comprehensive logging

**Use if**: You're comfortable with Node.js / want pure JavaScript

### `market_auto_start.py`
**Python version** - Alternative if you prefer Python

Features:
- Uses `APScheduler` library
- Similar functionality to Node.js version
- May be easier if your stack is mostly Python
- Requires: `pip install APScheduler requests python-dateutil schedule`

**Use if**: You prefer Python or have Python-heavy stack

### `setup-auto-start.sh`
**Bash setup script** - Automates everything

Does:
- Checks prerequisites (Node.js, PM2)
- Installs dependencies
- Creates log directory
- Starts scheduler with PM2
- Configures PM2 auto-startup

**Run this once** - Handles all configuration

### `MARKET_AUTO_START_SETUP.md`
**Detailed setup guide**

Topics covered:
- Installation steps
- Troubleshooting common issues
- Monitoring & debugging
- Configuration options
- Advanced features (email alerts, log rotation)

**Read if**: You need detailed setup help or troubleshooting

### `HEALTH_ENDPOINT_SETUP.md`
**Guide to add `/health` endpoint**

Covers:
- Why health checks are important
- How to add `/health` endpoint to FastAPI
- Different implementation options
- Testing the endpoint

**Read if**: Your backend doesn't have a health endpoint yet

---

## 🔧 Configuration

Edit `market-auto-start.js` or `market_auto_start.py` to customize:

```javascript
const CONFIG = {
  PROJECT_PATH: '/var/www/mytradingSignal',      // Your project directory
  BACKEND_NAME: 'backend',                       // PM2 app name
  MARKET_OPEN_HOUR: 9,                           // 9 AM
  MARKET_OPEN_MINUTE: 0,
  PREOPEN_END_MINUTE: 15,                        // Until 9:15 AM
  MARKET_CLOSE_HOUR: 15,                         // 3:30 PM
  MARKET_CLOSE_MINUTE: 30,
};
```

After editing:
```bash
pm2 restart market-scheduler
```

---

## 📊 Monitoring & Debugging

### View Live Logs
```bash
pm2 logs market-scheduler                    # Live logs
pm2 logs market-scheduler --lines 50         # Last 50 lines
pm2 logs market-scheduler --since 1h         # Last hour
```

### View Log Files Directly
```bash
# Main activity log
tail -f /var/log/mytradingSignal/market-scheduler.log

# Error log
tail -f /var/log/mytradingSignal/market-scheduler-error.log
```

### Check Status
```bash
pm2 status
pm2 describe market-scheduler
```

### What to Expect in Logs at 9 AM

**Before 9:00 AM:**
```
🕐 Market Scheduler Check - 08:55:00
⏰ Outside market hours
```

**At 9:00 AM (Market Opens):**
```
⏰ 9:00 AM Market Open Event Triggered
🟠 PRE-OPEN PERIOD STARTING (9:00-9:15)
📊 Values will be frozen, no live feed yet

✅ Backend is already running
(or)
🔴 Backend is DOWN - Starting now...
🚀 Starting backend...
✅ Backend started successfully
⏳ Waiting 5 seconds for backend to initialize...
✅ Health check PASSED - Backend is responsive
```

**At 9:15 AM (Live Trading):**
```
⏰ 9:15 AM - Live Trading Started
🟢 LIVE TRADING PERIOD (9:15-3:30)
📈 Live market values streaming from WebSocket
```

**During Trading (Every 10 minutes):**
```
✅ Periodic health check PASSED
```

---

## 🐛 Troubleshooting

### Backend Not Starting
```bash
# Check if script is running
pm2 status

# Check logs
pm2 logs market-scheduler

# Manually test backend startup
cd /var/www/mytradingSignal
pm2 start backend/main.py --name backend --interpreter python3

# Check if server listens correctly
netstat -tulpn | grep 8000
```

### Wrong Timezone
```bash
# Check current timezone
timedatectl

# Set to IST if needed
sudo timedatectl set-timezone Asia/Kolkata

# Verify
timedatectl  # Should show Asia/Kolkata
```

### Health Check Failing
```bash
# Make sure backend has /health endpoint
curl http://localhost:8000/health

# If 404, add health endpoint (see HEALTH_ENDPOINT_SETUP.md)
# If timeout, backend might be slow - increase wait time in scheduler
```

### Scheduler Not Running
```bash
# Restart it
pm2 restart market-scheduler

# Or delete and restart
pm2 delete market-scheduler
pm2 start market-auto-start.js --name "market-scheduler"
pm2 save
```

---

## 📅 Market Holidays (2026-2027)

The scheduler automatically skips these dates:

**2026:**
- 26 Jan: Republic Day
- 25 Mar: Holi
- 02 Apr: Good Friday
- 01 May: Labour Day
- 17 Jul: Eid-ul-Adha
- 15 Aug: Independence Day
- 02 Sep: Janmastami
- 02 Oct: Gandhi Jayanti
- 25 Oct: Dussehra
- 01, 11 Nov: Diwali Holidays
- 25 Dec: Christmas

**2027:**
- 26 Jan: Republic Day
- 14 Mar: Holi
- 02 Apr: Good Friday
- 01 May: Labour Day
- 06 Jul: Eid-ul-Adha
- 15 Aug: Independence Day
- 19 Aug: Janmastami
- 02 Oct: Gandhi Jayanti
- 16 Oct: Dussehra
- 20-21 Oct: Diwali Holidays
- 25 Dec: Christmas

**Update**: Before 2028 starts, update `MARKET_HOLIDAYS_2028` array in the script.

---

## 🛠️ Manual Commands

```bash
# View PM2 list with all processes
pm2 list

# View detailed info about scheduler
pm2 describe market-scheduler

# View logs (live)
pm2 logs market-scheduler

# Restart scheduler
pm2 restart market-scheduler

# Stop scheduler (won't auto-start anymore)
pm2 stop market-scheduler

# Completely remove scheduler
pm2 delete market-scheduler

# Check what starts on boot
pm2 startup

# Save current PM2 setup
pm2 save

# View backend logs (if running as separate PM2 app)
pm2 logs backend
```

---

## 📝 Log Rotation (Optional)

Prevent logs from getting too large:

```bash
# Install logrotate (usually pre-installed on Ubuntu)
sudo apt-get install logrotate

# Create config file
sudo nano /etc/logrotate.d/mytradingsignal
```

Paste this:
```
/var/log/mytradingSignal/*.log {
    daily
    rotate 7
    compress
    delaycompress
    notifempty
    create 0644
}
```

This will:
- Rotate logs daily
- Keep 7 days of logs
- Compress old logs
- Delete empty logs

---

## 🔔 Email Alerts (Advanced)

Get notified when backend fails to start:

Add this to `market-auto-start.js` after `startBackend()` fails:

```javascript
if (!started) {
    // Send email alert
    execSync(
        `echo "Backend failed to start at 9 AM on ${new Date().toISOString()}" | ` +
        `mail -s "🚨 Trading Alert: Backend Failed to Start" your@email.com`
    );
}
```

Requires: `apt-get install mailutils`

---

## 🎯 Implementation Checklist

- [ ] Copy files to `/var/www/mytradingSignal/`
- [ ] Run `setup-auto-start.sh`
- [ ] Verify scheduler is running: `pm2 status`
- [ ] Add `/health` endpoint to backend (if not present)
- [ ] Test health endpoint: `curl http://localhost:8000/health`
- [ ] Wait until 8:55 AM to verify auto-start
- [ ] Check logs: `pm2 logs market-scheduler`
- [ ] Save logs location for monitoring: `/var/log/mytradingSignal/`

---

## ❓ FAQ

**Q: What happens if I reboot the server?**  
A: PM2 automatically restarts the scheduler (because we ran `pm2 startup`). No manual action needed.

**Q: Can I disable it temporarily?**  
A: Yes, run `pm2 stop market-scheduler`. To re-enable: `pm2 start market-scheduler`.

**Q: What if backend is already running at 9 AM?**  
A: Scheduler detects it and does nothing. No duplicate processes.

**Q: Does it work on weekends?**  
A: No, scheduler only runs Monday-Friday (stock market hours).

**Q: Can I change the start time from 9 AM?**  
A: Yes, edit `MARKET_OPEN_HOUR` and `MARKET_OPEN_MINUTE` in the script.

**Q: How often does it check if backend is running?**  
A: Every 1 minute all day, and every 10 minutes during market hours.

**Q: Can I run both Node.js and Python versions?**  
A: Not recommended - one will be enough. Pick based on your preference.

**Q: What logs should I check?**  
A: Main: `/var/log/mytradingSignal/market-scheduler.log`  
   Errors: `/var/log/mytradingSignal/market-scheduler-error.log`

---

## 📞 Support

If something isn't working:

1. **Check logs first**: `pm2 logs market-scheduler`
2. **Verify timezone**: `timedatectl` (should be Asia/Kolkata)
3. **Test health endpoint**: `curl http://localhost:8000/health`
4. **Check PM2 status**: `pm2 status`
5. **Check backend logs**: `pm2 logs backend`
6. **Check system logs**: `journalctl -n 50` (for system-level issues)

Common fixes:
- Restart scheduler: `pm2 restart market-scheduler`
- Check permissions: `ls -la /var/log/mytradingSignal/`
- Verify file ownership: `chown -R root:root /var/www/mytradingSignal/`

---

## 🎉 You're All Set!

Your backend will now automatically start every market day at 9 AM, without any manual intervention.

**Happy Trading!** 📈

---

**Last Updated:** February 2026  
**Version:** 1.0  
**Timezone:** IST (UTC+5:30)
