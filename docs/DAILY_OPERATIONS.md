# 📅 DAILY OPERATIONS GUIDE

## 🌅 MORNING ROUTINE (Before 9:00 AM IST)

### **CRITICAL**: Token Refresh (Every Day)
Zerodha tokens expire **every 24 hours**. You MUST refresh token before market opens.

---

## 🔄 TOKEN REFRESH OPTIONS

### **Option 1: UI Login (Recommended)** ⭐
**Time**: 8:00-8:50 AM (before auto-start)  
**Steps**:
1. Open https://mydailytradesignals.com
2. Click **"LOGIN"** button in header
3. Complete Zerodha OAuth (PIN + TOTP)
4. ✅ Token automatically saved to `.env`
5. ✅ System auto-reconnects within 0.3 seconds
6. ✅ No server restart needed

**Why this is best**:
- Zero terminal access required
- Works from any device (phone/tablet/laptop)
- Instant feedback in UI
- Token watcher handles everything

---

### **Option 2: Manual Script (Alternative)**
**Time**: 8:00-8:50 AM  
**Location**: Server terminal

```bash
# SSH to production server
ssh root@your-droplet-ip

# Navigate to backend
cd /var/www/mytradingSignal/backend

# Run token refresh script
python quick_token_fix.py

# Follow prompts:
# 1. Browser opens automatically
# 2. Login to Zerodha
# 3. Enter PIN + TOTP
# 4. Script captures token
# 5. Saves to .env
# 6. Token watcher detects change
# 7. Services reconnect automatically
```

**Output you should see**:
```
🔑 Zerodha Login Token Generator
================================
Opening browser...
✅ Token received: abcd1234...
✅ Token saved to .env
✅ Services will reconnect automatically
```

---

## ⏰ AUTOMATIC TIMELINE (No Action Required)

### 8:50 AM - Token Pre-Check
```
System automatically validates token
If valid: ✅ Ready for market
If expired: ❌ Shows login instructions
```

### 8:55 AM - Auto-Start
```
✅ Market Feed Service starts
✅ Connects to Zerodha WebSocket
✅ Subscribes to NIFTY, BANKNIFTY, SENSEX
✅ Redis cache initialized
✅ Frontend clients can connect
```

### 9:00 AM - Pre-Open
```
✅ Auction matching begins
✅ Prices move based on order flow
✅ Frontend shows "PRE_OPEN" status
✅ Data updates in real-time
```

### 9:07 AM - Freeze Period
```
🔒 Order matching complete
🔒 Price discovery done
🔒 Waiting for 9:15 AM live market
```

### 9:15 AM - Market LIVE
```
✅ Live trading begins
✅ Frontend shows "LIVE" status
✅ Real-time tick-by-tick data
✅ All indicators update
```

### 3:30 PM - Market Close
```
🛑 Trading ends
✅ Post-market data for 5 mins
```

### 3:35 PM - Auto-Stop
```
🛑 Market Feed Service stops
✅ Saves final cache state
✅ Closes WebSocket connection
✅ Waits for next trading day
```

---

## 🔍 MONITORING COMMANDS

### Check System Status
```bash
# Services status
sudo systemctl status mytradingsignal-backend
sudo systemctl status mytradingsignal-frontend

# Quick health check
curl http://localhost:8000/api/health

# Token status
curl http://localhost:8000/api/token-status
```

### View Live Logs
```bash
# Backend logs (shows scheduler, token checks, connections)
sudo journalctl -u mytradingsignal-backend -f --lines=50

# Filter for important events
sudo journalctl -u mytradingsignal-backend -f | grep "SCHEDULER\|TOKEN\|MARKET"

# Frontend logs
sudo journalctl -u mytradingsignal-frontend -f --lines=20
```

### Morning Logs (8:50-9:00 AM)
```bash
# View token check and auto-start
sudo journalctl -u mytradingsignal-backend --since "08:50" --until "09:05"
```

Expected output:
```
8:50 AM - 🔐 PRE-MARKET TOKEN CHECK (8:50 AM)
8:50 AM - ✅ Token VALID and ACTIVE
8:50 AM - Token Age: 5.2 hours
8:50 AM - Ready for 9:00 AM market open
8:55 AM - ⏰ MARKET HOURS - Feed NOT Connected
8:55 AM - 🚀 Starting market feed...
8:55 AM - ✅ Feed started successfully!
9:00 AM - ✅ Feed ACTIVE - 🟡 PRE-OPEN (auction matching 9:00-9:07)
9:15 AM - ✅ Feed ACTIVE - 🟢 LIVE TRADING
```

---

## ⚠️ TROUBLESHOOTING

### Issue: "Token expired" at 8:50 AM

**Symptoms**:
```
8:50 AM - 🔴 TOKEN EXPIRED - CANNOT CONNECT
8:55 AM - ⏸️ SCHEDULER PAUSED - Waiting for valid token
```

**Solution**:
1. Open https://mydailytradesignals.com
2. Click LOGIN
3. Complete Zerodha OAuth
4. Within 0.3 seconds: ✅ "Token updated successfully"
5. System auto-reconnects

**Alternative**:
```bash
python /var/www/mytradingSignal/backend/quick_token_fix.py
```

---

### Issue: "No data at 9:00 AM"

**Check 1**: System started on time?
```bash
sudo journalctl -u mytradingsignal-backend --since "08:55" --until "09:05"
# Should show: "Feed started successfully" at 8:55 AM
```

**Check 2**: Token valid?
```bash
curl http://localhost:8000/api/token-status
# Should show: "status": "valid"
```

**Check 3**: Zerodha API working?
```bash
curl https://kite.zerodha.com
# Should return: 200 OK
# Check status: https://status.zerodha.com
```

---

### Issue: "WebSocket connection failed"

**Symptoms**:
- Frontend shows "OFFLINE" or "REST API" status
- Logs show: "WebSocket failed, using REST fallback"

**This is NORMAL if**:
- REST fallback provides data (check frontend for prices)
- Data updates every 1-3 seconds

**Action required if**:
- No data at all
- Frontend shows "OFFLINE"

**Solution**:
```bash
# Restart backend service
sudo systemctl restart mytradingsignal-backend

# Monitor reconnection
sudo journalctl -u mytradingsignal-backend -f
```

---

## 📊 WEEKLY CHECKLIST

### Monday Morning
- [ ] Verify token refreshed over weekend
- [ ] Check auto-start at 8:55 AM
- [ ] Monitor pre-open data (9:00-9:07 AM)
- [ ] Verify live market data (9:15 AM+)

### Daily (Tue-Fri)
- [ ] Token refreshed before 8:50 AM
- [ ] Services auto-start at 8:55 AM
- [ ] No manual intervention required

### Friday Evening
- [ ] Services auto-stop at 3:35 PM
- [ ] Check disk space: `df -h`
- [ ] Backup logs if needed
- [ ] Plan weekend maintenance if required

---

## 🔐 SECURITY REMINDERS

### Never Share
- ❌ ZERODHA_API_KEY
- ❌ ZERODHA_API_SECRET
- ❌ ZERODHA_ACCESS_TOKEN
- ❌ JWT_SECRET

### Rotate Regularly
- JWT_SECRET: Every 90 days
- Server SSH keys: Every 180 days
- SSL certificates: Auto-renewed by Certbot

### Access Control
- Production `.env`: Only root user
- Logs: Monitor for unauthorized access attempts
- Firewall: Only ports 80, 443, 8000 open

---

## 📞 EMERGENCY CONTACTS

### Zerodha Support
- https://support.zerodha.com
- support@zerodha.com
- Phone: 080-4940-2020

### API Status
- https://status.zerodha.com
- Check before troubleshooting

### Your Setup
- Frontend: https://mydailytradesignals.com
- Backend API: https://mydailytradesignals.com/api
- Health Check: https://mydailytradesignals.com/api/health

---

## 🎯 SUCCESS INDICATORS

### Healthy System Shows:
✅ Token age < 20 hours  
✅ Services active (systemctl status)  
✅ Auto-start at 8:55 AM (no manual intervention)  
✅ Pre-open data from 9:00 AM  
✅ Live data from 9:15 AM  
✅ Auto-stop at 3:35 PM  
✅ Frontend shows green connection dot  
✅ Prices update in real-time  

### Unhealthy System Shows:
❌ Token age > 20 hours  
❌ Services inactive  
❌ Manual start required  
❌ No pre-open data  
❌ Frontend shows red/offline  
❌ Prices frozen  

---

## 📝 NOTES

### Token Expiry
- Zerodha tokens expire at **midnight (00:00 IST)**
- Token age counter resets daily
- You have **~8 hours** window (midnight to 8:50 AM) to refresh

### Best Practice
- **Refresh token at 8:00 AM** (50 mins buffer)
- Use UI login (most convenient)
- Keep phone/laptop ready for TOTP

### Weekend/Holidays
- No action required on weekends (system doesn't start)
- Scheduler checks NSE_HOLIDAYS automatically
- Monday morning: Ensure token refreshed before 8:50 AM

---

**Last Updated**: February 16, 2026  
**Version**: 1.0.0  
**Maintained by**: System Administrator
