# ✅ Auto-Start System - Master Checklist

Use this to track implementation progress. Check off each step as you complete it.

---

## 📥 Phase 1: Initial Setup (Do This First)

### 1.1 Get All Files
- [ ] Downloaded/created `market-auto-start.js` 
- [ ] Downloaded/created `setup-auto-start.sh`
- [ ] Have access to `market_auto_start.py` (backup option)
- [ ] Have all documentation files (.md files)

**Status Check:**
```bash
ls -la *.js *.sh *.md | grep -E "market|setup|README"
```

### 1.2 Copy Files to Server
- [ ] Connected to DigitalOcean server via SSH
- [ ] Copied (or created) `market-auto-start.js` to `/var/www/mytradingSignal/`
- [ ] Copied (or created) `setup-auto-start.sh` to `/var/www/mytradingSignal/`
- [ ] Made setup script executable: `chmod +x setup-auto-start.sh`

**Status Check:**
```bash
ls -la /var/www/mytradingSignal/market-auto-start.js
ls -la /var/www/mytradingSignal/setup-auto-start.sh
```

### 1.3 Read Documentation
- [ ] Read `README_AUTO_START.md` (overview)
- [ ] Read `IMPLEMENTATION_SUMMARY.md` (understand what's happening)
- [ ] Skimmed `MARKET_AUTO_START_SETUP.md` (for reference)

---

## 🚀 Phase 2: Installation (Do This Before Market Hours)

### 2.1 Prerequisites Check
- [ ] Node.js is installed: `node --version`
- [ ] npm is installed: `npm --version`
- [ ] PM2 is installed: `pm2 --version`
- [ ] Project directory exists: `test -d /var/www/mytradingSignal`

**If any missing, install:**
```bash
# Node.js and npm (already should be installed if frontend running)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# PM2 (if not already global)
npm install -g pm2
```

### 2.2 Run Setup Script
- [ ] Navigated to project: `cd /var/www/mytradingSignal`
- [ ] Ran: `bash setup-auto-start.sh`
- [ ] Setup completed without errors

**Status Check:**
```bash
pm2 list | grep market-scheduler
# Should show: market-scheduler online
```

### 2.3 Verify Installation
- [ ] Scheduler is running: `pm2 status market-scheduler`
- [ ] Log directory created: `ls -la /var/log/mytradingSignal/`
- [ ] No errors in: `pm2 logs market-scheduler --lines 20`

**If having issues, run diagnostic:**
```bash
bash /var/www/mytradingSignal/diagnose-scheduler.sh
```

---

## 🔧 Phase 3: Backend Health Endpoint (Critical)

### 3.1 Check if Health Endpoint Exists
- [ ] Know where backend `main.py` is located
- [ ] Tested endpoint while backend running:
```bash
# While backend is running
curl http://localhost:8000/health
# Should return: {"status":"ok"} with HTTP 200
```

- [ ] If you got 404 error → You need to add health endpoint

### 3.2 Add Health Endpoint (If Missing)
- [ ] Read `HEALTH_ENDPOINT_SETUP.md`
- [ ] Chose implementation option (1, 2, or 3)
- [ ] Added code to backend
- [ ] Restarted backend: `pm2 restart backend`
- [ ] Tested endpoint again: `curl http://localhost:8000/health`
- [ ] Confirmed HTTP 200 response

**Quick test script:**
```bash
# Start backend if not running
pm2 start /var/www/mytradingSignal/backend/main.py --name backend --interpreter python3

# Wait 3 seconds for startup
sleep 3

# Test health endpoint
curl -v http://localhost:8000/health
```

---

## 🌍 Phase 4: Timezone Verification

### 4.1 Check Timezone
- [ ] Verified timezone is IST: `timedatectl`
- [ ] Timezone shows: `Asia/Kolkata`

**If wrong timezone, fix it:**
```bash
sudo timedatectl set-timezone Asia/Kolkata
timedatectl  # Verify it changed
```

### 4.2 Verify Time Accuracy
- [ ] Server time matches IST
- [ ] Can check with: `date -R`
- [ ] Time difference from actual ≤ 1 minute

**If time is off, sync with NTP:**
```bash
sudo apt-get install ntp
sudo systemctl restart ntp
```

---

## 🔍 Phase 5: Diagnostics & Configuration

### 5.1 Run Full Diagnostic
- [ ] Ran: `bash /var/www/mytradingSignal/diagnose-scheduler.sh`
- [ ] Result shows: "✅ All checks passed! System is healthy."
- [ ] Fixed any CRITICAL issues shown
- [ ] Noted any WARNINGS for monitoring

**Diagnostic output should show:**
- ✅ Node.js Installed
- ✅ PM2 Global
- ✅ Project Directory
- ✅ Scheduler Script
- ✅ Backend Directory
- ✅ Log Directory
- ✅ Scheduler is registered in PM2
- ✅ Scheduler is RUNNING
- ✅ Timezone is correct

### 5.2 Review Configuration (Optional)
- [ ] Reviewed timing in `market-auto-start.js`:
  ```javascript
  MARKET_OPEN_HOUR: 9,        // 9 AM
  PREOPEN_END_MINUTE: 15,     // 9:15 AM
  MARKET_CLOSE_HOUR: 15,      // 3:30 PM
  MARKET_CLOSE_MINUTE: 30,
  ```
- [ ] Confirmed timing is correct for your markets
- [ ] No changes needed (unless custom hours required)

---

## 📊 Phase 6: Monitoring Setup

### 6.1 Log Locations
- [ ] Know main log location: `/var/log/mytradingSignal/market-scheduler.log`
- [ ] Know error log location: `/var/log/mytradingSignal/market-scheduler-error.log`
- [ ] Can view logs: `tail -f /var/log/mytradingSignal/market-scheduler.log`

### 6.2 PM2 Monitoring
- [ ] Familiar with: `pm2 logs market-scheduler`
- [ ] Familiar with: `pm2 status`
- [ ] Familiar with: `pm2 describe market-scheduler`

### 6.3 Create Monitoring Script (Optional)
- [ ] Created cron job to check daily at 8:50 AM (if desired)
- [ ] Or set phone reminder to check at 8:55 AM first trading day

**Optional monitoring cron (add with `crontab -e`):**
```
50 8 * * 1-5 pm2 logs market-scheduler --lines 50 > /tmp/morning-check.log
```

---

## 🧪 Phase 7: Pre-Launch Testing

### 7.1 Test at Off-Hours (Do This Evening)
- [ ] Manually trigger market open logic (for testing):
  ```bash
  # Force restart scheduler to test startup logs
  pm2 restart market-scheduler
  ```
- [ ] Watched logs for initialization
- [ ] Confirmed no errors in logs

### 7.2 Test Tomorrow Morning (Best Test)
- [ ] Set phone alarm for 8:55 AM tomorrow
- [ ] Wake up and check logs before 9 AM
- [ ] Watch scheduler detect 9 AM and start backend
- [ ] Verify backend becomes responsive
- [ ] Confirm health check passes

### 7.3 Test During Trading Hours
- [ ] Confirmed backend is running at 9:15 AM
- [ ] Confirmed WebSocket is receiving live data
- [ ] Confirmed dashboard shows live values (not frozen)
- [ ] Let it run for at least 1 hour to be sure

### 7.4 Test Error Recovery (Optional)
- [ ] Manually stopped backend: `pm2 stop backend`
- [ ] Watched scheduler detect it within 10 minutes
- [ ] Confirmed scheduler auto-restarted backend
- [ ] Verified health check confirmed restart worked

**Command to manually test auto-restart:**
```bash
# Stop backend
pm2 stop backend

# Wait 10 minutes (scheduler health check runs every 10 min)
# Or restart scheduler to trigger check immediately
pm2 restart market-scheduler --wait-ready

# Check logs
pm2 logs market-scheduler

# Should see: "Backend crashed during market hours - Restarting..."
```

---

## ✨ Phase 8: Production Deployment (Go-Live)

### 8.1 Final Checks (Day Before Launch)
- [ ] All diagnostic checks pass: `bash diagnose-scheduler.sh`
- [ ] Scheduler is online: `pm2 status | grep market-scheduler`
- [ ] Backend responds to health check: `curl http://localhost:8000/health`
- [ ] Timezone is correct: `timedatectl | grep Zone`
- [ ] Logs are accessible: `tail -5 /var/log/mytradingSignal/market-scheduler.log`

### 8.2 Save PM2 Configuration
- [ ] Ran: `pm2 save`
- [ ] Ran: `pm2 startup` (or `sudo pm2 startup -u root --hp /root`)
- [ ] Saved PM2 dump to ensure auto-startup on reboot

**Verify PM2 startup is configured:**
```bash
ls -la /lib/systemd/system/pm2-*.service
# Should have entries for your user
```

### 8.3 Monitor on First Market Days
- [ ] Set alerts for 9:00 AM for next 3 trading days
- [ ] Check logs manually each day:
  ```bash
  grep "9:00 AM" /var/log/mytradingSignal/market-scheduler.log
  ```
- [ ] Verify "Backend started successfully" appears in logs
- [ ] Confirm dashboard shows live values by 9:15 AM

### 8.4 Document Everything
- [ ] Saved server details (IP, SSH key location, project path)
- [ ] Saved log file locations
- [ ] Saved PM2 commands you use frequently
- [ ] Created runbook for common issues

---

## 🎯 Phase 9: Long-Term Maintenance

### 9.1 Monthly Checks
- [ ] Run: `bash diagnose-scheduler.sh` once per month
- [ ] Review logs: `zcat /var/log/mytradingSignal/market-scheduler.log*`
- [ ] Check disk space: `df -h` (ensure /var/log has space)
- [ ] Confirm PM2 startup still configured: `pm2 status`

### 9.2 At Year-End
- [ ] Update market holidays for next year in script:
  ```javascript
  const MARKET_HOLIDAYS_2027 = [...];  // Update to 2028 before year ends
  ```
- [ ] Test with updated holidays before next year starts
- [ ] Update documentation with any changes made

### 9.3 Log Maintenance
- [ ] Set up log rotation (optional but recommended):
  ```bash
  sudo nano /etc/logrotate.d/mytradingsignal
  # Add rotation rules (see MARKET_AUTO_START_SETUP.md)
  ```
- [ ] Monitor log file sizes: `du -sh /var/log/mytradingSignal/`
- [ ] Archive old logs quarterly

### 9.4 Hardware Monitoring
- [ ] Check server health monthly
- [ ] Monitor CPU/memory during trading (should be light load)
- [ ] Log memory leaks if any: `pm2 monit`

---

## 🚨 Troubleshooting Checklist

### When Backend Doesn't Start at 9 AM

**1. Check Scheduler is Running**
- [ ] Ran: `pm2 status market-scheduler`
- [ ] Result shows: `online`
- [ ] If not online → `pm2 restart market-scheduler`

**2. Check Logs**
- [ ] Ran: `tail -50 /var/log/mytradingSignal/market-scheduler.log`
- [ ] Look for error messages
- [ ] Search for "9:00 AM" to find log entries

**3. Check Backend**
- [ ] Backend exists: `test -f /var/www/mytradingSignal/backend/main.py`
- [ ] Can start manually: `pm2 start backend/main.py --name test-backend`
- [ ] Health works: `curl http://localhost:8000/health`

**4. Check Timezone**
- [ ] Ran: `timedatectl`
- [ ] Shows: `Asia/Kolkata`
- [ ] If wrong: `sudo timedatectl set-timezone Asia/Kolkata`

**5. Run Diagnostic**
- [ ] Ran: `bash diagnose-scheduler.sh`
- [ ] Fixed any CRITICAL issues listed

### When Backend Crashes During Trading

**1. Check if Scheduler Detected It**
- [ ] Ran: `pm2 logs market-scheduler --lines 100`
- [ ] Search for: "Backend crashed" or "Health check FAILED"

**2. Check if Auto-Restart Attempted**
- [ ] Logs should show: "attempting restart"
- [ ] If not shown → scheduler might be down

**3. Manually Restart**
- [ ] Ran: `pm2 restart backend`
- [ ] Verify: `curl http://localhost:8000/health`
- [ ] Compare with scheduler logs to see if similar error

**4. If Repeated Crashes**
- [ ] Check backend logs: `pm2 logs backend --lines 200`
- [ ] Look for Python errors or crash traces
- [ ] Fix underlying backend issue

### When Logs Show Errors

**1. Parse Error Message**
- [ ] Find line with "ERROR" or "❌"
- [ ] Read full error message (may span multiple lines)
- [ ] Search Google/GitHub for that specific error

**2. Check Dependencies**
- [ ] Verify node-cron installed: `npm list node-cron`
- [ ] If missing: `npm install node-cron`
- [ ] Restart scheduler: `pm2 restart market-scheduler`

**3. Check File Permissions**
- [ ] Check log directory writable: `test -w /var/log/mytradingSignal/`
- [ ] Fix if needed: `sudo chmod 755 /var/log/mytradingSignal`

**4. Check Disk Space**
- [ ] Ran: `df -h` and `du -sh /var/log`
- [ ] If full: clean up old logs or set up rotation

---

## 📋 Quick Reference Card

Keep this handy for daily use:

### Daily Commands
```bash
# Check if running
pm2 status

# View logs (real-time)  
pm2 logs market-scheduler

# View logs (file)
tail -50 /var/log/mytradingSignal/market-scheduler.log

# Run health check
curl http://localhost:8000/health

# Check timezone
timedatectl
```

### Emergency Commands  
```bash
# Restart if stuck
pm2 restart market-scheduler

# Force stop
pm2 stop market-scheduler

# Delete and restart fresh
pm2 delete market-scheduler
pm2 start /var/www/mytradingSignal/market-auto-start.js --name market-scheduler

# See what's using port 8000
lsof -i :8000
```

### Monitoring Commands
```bash
# Run diagnostic
bash diagnose-scheduler.sh

# See all PM2 processes
pm2 list

# Watch resource usage
pm2 monit

# See detailed process info
pm2 describe market-scheduler
```

---

## 🎉 Completion Checklist

When you're done with ALL phases above:

- [ ] ✅ Phase 1: Initial Setup - DONE
- [ ] ✅ Phase 2: Installation - DONE
- [ ] ✅ Phase 3: Backend Health Endpoint - DONE
- [ ] ✅ Phase 4: Timezone Verification - DONE
- [ ] ✅ Phase 5: Diagnostics - DONE
- [ ] ✅ Phase 6: Monitoring Setup - DONE
- [ ] ✅ Phase 7: Pre-Launch Testing - DONE
- [ ] ✅ Phase 8: Production Deployment - DONE
- [ ] ✅ Phase 9: Long-Term Maintenance Plan - DONE

**System is ready for production!**

Your backend will now automatically start every market day at 9:00 AM, no manual intervention required.

**Next action:** Wait for tomorrow's market open and verify it works! 🚀

---

**Created:** February 2026  
**Last Updated:** February 18, 2026
