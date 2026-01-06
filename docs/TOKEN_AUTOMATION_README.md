# 🔧 Token Automation - Complete Setup Guide

## The Problem You're Facing

**Symptoms on Digital Ocean**:
- ❌ Feed shows "disconnected"
- ❌ Auth shows errors
- ❌ Market shows "CLOSED" even when it should be open
- ✅ Local works fine (because you manually refresh)

**Root Cause**: Zerodha tokens expire **daily at 7:30 AM IST**, but your Digital Ocean deployment has **no automation** to refresh them.

---

## 🎯 Quick Solution (Choose One)

### For Linux/Mac/Digital Ocean (RECOMMENDED):

```bash
# SSH into your server
ssh root@your-droplet-ip
cd /path/to/mytradingSignal

# One-command setup
chmod +x setup_token_cron.sh && ./setup_token_cron.sh

# Verify
crontab -l
```

### For Windows Servers:

```powershell
# Run as Administrator
cd C:\path\to\mytradingSignal
.\setup_token_task.ps1
```

### For Docker Deployments:

Add to `docker-compose.yml`:
```yaml
  token-refresher:
    image: python:3.11-slim
    volumes:
      - ./:/app
    working_dir: /app
    environment:
      - TZ=Asia/Kolkata
    command: >
      bash -c "
      pip install kiteconnect python-dotenv &&
      echo '15 2 * * * python /app/auto_token_refresh.py >> /app/logs/token_refresh.log 2>&1' | crontab - &&
      cron -f
      "
    restart: unless-stopped
```

Then: `docker-compose up -d`

---

## 📁 New Files Created

### Automation Scripts:

| File | Purpose | When to Use |
|------|---------|-------------|
| `auto_token_refresh.py` | Automated token refresh | Called by cron/scheduler |
| `setup_token_cron.sh` | Linux cron setup | Run once on Linux servers |
| `setup_token_task.ps1` | Windows Task Scheduler | Run once on Windows servers |
| `refresh_token_cron.sh` | Cron job script | Created by setup script |
| `do_setup.sh` | Complete Digital Ocean setup | First-time setup |

### Documentation:

| File | Content |
|------|---------|
| `QUICKSTART_DO_FIX.md` | Quick fix for Digital Ocean |
| `setup_do_token_refresh.md` | Detailed setup options |
| `docs/TOKEN_REFRESH_EXPLAINED.md` | Visual explanation |

---

## 🚀 Complete Setup: Step by Step

### Step 1: Initial Token Generation (FIRST TIME ONLY)

**On your LOCAL machine**:
```bash
python manual_token_refresh.py
```

This opens Zerodha login → Copy token from URL → Saves to `backend/.env`

**Copy this token** to your Digital Ocean `backend/.env` file.

### Step 2: Set Up Automation on Digital Ocean

**SSH into Digital Ocean**:
```bash
ssh root@your-droplet-ip
cd /var/www/mytradingSignal  # or wherever your app is

# Run automated setup
chmod +x setup_token_cron.sh
./setup_token_cron.sh
```

**What this does**:
1. Creates `refresh_token_cron.sh` script
2. Adds cron job to run at 7:45 AM IST daily (2:15 AM UTC)
3. Creates `logs/` directory for logging
4. Configures auto-restart of backend after token refresh

### Step 3: Verify Setup

```bash
# Check cron job
crontab -l
# Should show: 15 2 * * * /path/to/mytradingSignal/refresh_token_cron.sh

# Test manually
./refresh_token_cron.sh

# Check logs
tail -f logs/token_refresh.log

# Check backend health
curl http://localhost:8000/api/system/health | jq
```

### Step 4: Restart Backend

```bash
# Docker
docker restart trading-backend

# Systemd
sudo systemctl restart trading-backend

# Manual
cd backend && uvicorn main:app --host 0.0.0.0 --port 8000
```

### Step 5: Monitor

Check logs daily for the first week:
```bash
tail -f logs/token_refresh.log
```

---

## ⚙️ How It Works

### The Magic Sequence:

```
1. Cron Job (7:45 AM IST)
   ↓
2. Runs auto_token_refresh.py
   ↓
3. Checks if token expired (yes, it expires at 7:30 AM)
   ↓
4. Attempts to generate new token
   ↓
5. Saves new token to backend/.env
   ↓
6. Token Watcher (watchdog) detects .env change
   ↓
7. Clears settings cache
   ↓
8. Backend auto-reloads token
   ↓
9. Reconnects to Zerodha (NO RESTART!)
   ↓
10. Feed connected ✅
    ↓
11. Markets open at 9:15 AM → Data flowing! ✅
```

### Key Features:

- ✅ **Zero Downtime**: Backend auto-detects token changes
- ✅ **No Restart Needed**: Uses file watcher for hot reload
- ✅ **Logging**: All actions logged to `logs/token_refresh.log`
- ✅ **Error Handling**: Falls back to manual if auto-refresh fails
- ✅ **Timezone Aware**: Respects IST market timing

---

## 📊 Token Lifecycle Timeline

```
Time (IST) | Event                    | Token State | App State
──────────────────────────────────────────────────────────────
7:00 AM    | Old token valid          | Valid ✅    | Working ✅
7:30 AM    | Zerodha expires token    | Expired ❌  | Broken ❌
7:45 AM    | Cron runs auto-refresh   | Refreshing  | Updating...
7:46 AM    | New token saved          | Valid ✅    | Reconnecting
7:47 AM    | Backend detects change   | Valid ✅    | Connected ✅
9:15 AM    | Markets open             | Valid ✅    | Data live! ✅
3:30 PM    | Markets close            | Valid ✅    | "CLOSED" ✅
```

**Notice**: Only 15-minute window (7:30-7:45 AM) where app might be down, which is **before** markets open!

---

## 🐛 Troubleshooting

### Issue: Token refresh fails

**Check logs**:
```bash
tail -50 logs/token_refresh.log
```

**Common causes**:
- No stored `ZERODHA_REQUEST_TOKEN` in `.env` (run `manual_token_refresh.py` first)
- API credentials incorrect
- Network issue

**Fix**: Run manual refresh
```bash
python manual_token_refresh.py
```

### Issue: Cron not running

**Check cron status**:
```bash
sudo systemctl status cron

# Check if cron job exists
crontab -l

# Check system logs
grep CRON /var/log/syslog
```

**Fix**: Re-run setup
```bash
./setup_token_cron.sh
```

### Issue: Backend not detecting token change

**Check if token watcher is running**:
```bash
# Look for watchdog in process list
ps aux | grep watchdog

# Check backend logs
docker logs trading-backend
```

**Fix**: Restart backend
```bash
docker restart trading-backend
```

### Issue: Permission denied

**Fix permissions**:
```bash
chmod +x setup_token_cron.sh
chmod +x refresh_token_cron.sh
chmod +x auto_token_refresh.py
```

---

## 🔍 Verification Checklist

After setup, verify:

- [ ] Cron job exists: `crontab -l`
- [ ] Scripts are executable: `ls -la *.sh`
- [ ] Logs directory exists: `ls -la logs/`
- [ ] Manual test works: `./refresh_token_cron.sh`
- [ ] Backend health good: `curl localhost:8000/api/system/health`
- [ ] Frontend loads: Open in browser
- [ ] WebSocket connects: Check browser console (F12)

---

## 📚 Additional Resources

### Quick References:
- **Immediate fix**: See `QUICKSTART_DO_FIX.md`
- **Visual explanation**: See `docs/TOKEN_REFRESH_EXPLAINED.md`
- **All options**: See `setup_do_token_refresh.md`

### Health Monitoring:
- Set up UptimeRobot (free) to ping: `http://your-domain.com/api/system/health`
- Get alerts if health check fails
- Recommended: Check every 5 minutes

### Log Monitoring:
```bash
# View last 50 lines
tail -50 logs/token_refresh.log

# Follow logs in real-time
tail -f logs/token_refresh.log

# Search for errors
grep -i error logs/token_refresh.log
```

---

## 🎯 Best Practices

### Do:
✅ Set up automation on **first deployment**
✅ Monitor logs for **first 3-7 days**
✅ Set up health check monitoring (UptimeRobot)
✅ Keep backup: `manual_token_refresh.py` on local machine
✅ Test token refresh manually once: `./refresh_token_cron.sh`

### Don't:
❌ Deploy without automation (app will break daily)
❌ Ignore logs for the first week
❌ Forget to update futures tokens monthly
❌ Remove `manual_token_refresh.py` (it's your backup!)
❌ Change cron time (7:45 AM IST is optimal)

---

## 🆘 Emergency Procedures

### If token refresh fails completely:

1. **SSH into server**:
   ```bash
   ssh root@your-droplet-ip
   cd /path/to/mytradingSignal
   ```

2. **Run manual refresh**:
   ```bash
   python manual_token_refresh.py
   ```

3. **Restart backend**:
   ```bash
   docker restart trading-backend
   # or
   systemctl restart trading-backend
   ```

4. **Verify**:
   ```bash
   curl localhost:8000/api/system/health | jq
   ```

5. **Check why automation failed**:
   ```bash
   tail -100 logs/token_refresh.log
   ```

---

## 🎉 Success Indicators

Your setup is working correctly if:

✅ Cron job runs daily at 7:45 AM IST
✅ Logs show successful token refresh
✅ Backend health check shows `"state": "AUTHENTICATED"`
✅ Feed shows `"state": "CONNECTED"`
✅ Frontend displays live data during market hours
✅ No errors in `logs/token_refresh.log`

---

## 💡 Pro Tips

1. **Test during non-market hours**: Run `./refresh_token_cron.sh` manually to verify it works

2. **Set up alerts**: Use UptimeRobot or similar to alert you if health check fails

3. **Monitor first week**: Check logs daily for 7 days to ensure smooth operation

4. **Document your deployment**: Note your specific paths, service names, and cron schedule

5. **Keep backups**: Store your `.env` file securely (encrypted) as backup

---

## 📞 Need Help?

1. **Read visual explanation**: `docs/TOKEN_REFRESH_EXPLAINED.md`
2. **Check logs**: `tail -f logs/token_refresh.log`
3. **Test health**: `curl localhost:8000/api/system/health`
4. **Emergency fix**: `python manual_token_refresh.py`
5. **Verify cron**: `crontab -l`

---

## Summary: 3-Step Setup

```bash
# 1. Initial token (on local machine)
python manual_token_refresh.py

# 2. Setup automation (on Digital Ocean)
ssh root@your-droplet-ip
cd /path/to/mytradingSignal
./setup_token_cron.sh

# 3. Verify
tail -f logs/token_refresh.log
curl localhost:8000/api/system/health
```

**That's it!** Your trading platform now runs 24/7 automatically! 🚀
