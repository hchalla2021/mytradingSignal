# 🚨 Quick Troubleshooting Guide - "Reconnecting to market feed…"

## ⚡ Quick Diagnosis (30 seconds)

### Is it 9:00-9:15 AM (Pre-open to Live transition)?
- **YES?** → Go to [Pre-open Low Ticks](#pre-open-low-ticks-normal)
- **NO?** → Continue below

### Is your backend showing this error?
```
🔴 TOKEN EXPIRED - CANNOT CONNECT
```
- **YES?** → Go to [Token Expired](#1-token-expired)
- **NO?** → Continue below

### Check backend logs for "Reconnecting" spam
```
🔄 Reconnecting... Attempt 1
🔄 Reconnecting... Attempt 2
🔄 Reconnecting... Attempt 3
```
- **YES (endless)** → Go to [Endless Reconnecting Loop](#2-endless-reconnecting-loop)
- **NO** → Continue below

### Check server timezone
```bash
timedatectl
```
- **Shows UTC instead of Asia/Kolkata?** → Go to [Wrong Timezone](#4-wrong-server-timezone)

---

## 🔧 Solutions

### 1. Token Expired

**Error Message:**
```
🔴 TOKEN EXPIRED - CANNOT CONNECT
Zerodha tokens expire every 24 hours at midnight.
A new token is required for market data.
```

**What's happening:**
- Token was generated yesterday, expired at midnight
- Backend detected expired token at 8:45 AM check
- Refusing to attempt connection (prevents the "reconnecting forever" issue)
- **This is a GOOD thing** - it's telling you the real problem!

**Fix (Choose ONE):**

**Option A: Quick Login (5 seconds)**
1. Open your trading app in browser
2. Click the 🔑 **LOGIN** button (top-right)
3. Complete Zerodha authentication
4. Backend auto-refreshes token and reconnects

**Option B: Manual Token Script (1 minute)**
```bash
cd backend
python quick_token_fix.py
# Follow the prompts
```

**Option C: Manual Process (2 minutes)**
```bash
# Step 1: Open this URL in browser
https://kite.zerodha.com/connect/login?api_key=YOUR_API_KEY

# Step 2: Login with your Zerodha credentials

# Step 3: Copy the request_token from redirect URL
# Example: https://localhost/?request_token=abc123xyz&status=success

# Step 4: Generate access token
cd backend
python get_token.py
# Paste the request_token and press Enter

# Step 5: Token is auto-saved to .env and backend reconnects
```

**Verification:**
```bash
# Check token age
tail -5 backend/.env | grep ZERODHA_ACCESS_TOKEN

# Backend should show (within 30 seconds):
✅ Token VALID (age: 0.1 hours)
```

---

### 2. Endless Reconnecting Loop

**Error Message:**
```
🔄 Reconnecting... Attempt 1
🔄 Reconnecting... Attempt 2
🔄 Reconnecting... Attempt 3
[keeps repeating]
```

**Root Cause #1: Missing Re-subscription**
- WebSocket reconnects but doesn't re-subscribe to tokens
- Socket is alive but no ticks received
- App looks frozen

**Root Cause #2: 403 Forbidden Error**
- Token is invalid but old code doesn't detect it
- KiteTicker tries to reconnect forever
- Same result - no ticks, looks broken

**Fix:**
```bash
# Verify your backend has the latest code
# with re-subscription logic in _on_reconnect():

grep -n "Re-subscribing to" backend/services/market_feed.py

# Should show (around line 1000):
# 📡 Re-subscribing to 3 tokens: NIFTY, BANKNIFTY, SENSEX
```

If NOT found, update to latest code:
```bash
# Pull latest version
git pull origin main

# Restart backend
pkill -f "uvicorn"
cd backend && uvicorn main:app --reload
```

If ALREADY there, the issue is something else:

**Check Docker Container:**
```bash
# If using Docker
docker logs -f trading-backend

# Look for:
❌ Error 403 Forbidden
🔴 Access token invalid
⚠️ Zerodha WebSocket error
```

If you see these errors → See [Token Expired](#1-token-expired) fix

**Check Network:**
```bash
# Test Zerodha connectivity
ping -c 1 kite.zerodha.com

# If timeout:
# 1. Check server internet connection
# 2. Check firewall rules
# 3. Ask hosting provider if port 443 is open
```

---

### 3. Pre-open Low Ticks (Normal)

**What You See (9:00-9:07 AM):**
```
UI shows stale data
Very few ticks arriving
Volume/OI updates frozen
UI looks "stuck"
```

**Important: THIS IS NORMAL!**

Between 9:00 AM - 9:07 AM, Zerodha enters **"Price Discovery Freeze"** mode:
- Auction matching phase
- Only a few ticks broadcast
- Volume trading is happening but not streamed
- This is normal market behavior (NSE rule, not a bug)

**Expected Behavior:**
- Slow ticks OK (maybe 1 tick per 2 seconds)
- Volume may not change
- OI frozen
- At 9:07 AM: First order matching completes
- At 9:15 AM: Full trading volume resumes

**What to NOT Worry About:**
- ❌ "Reconnecting to market feed..." message - expected during freeze
- ❌ Missing ticks - freeze phase has fewer ticks
- ❌ Frozen volume - normal for this time

**What TO Worry About:**
- ✅ Still no ticks after 9:15 AM - now it's a real problem
- ✅ Connection quality shows RED (not yellow) - real issue
- ✅ Backend logs show error messages - real issue

**Fix if stuck after 9:15 AM:**
- Refresh your browser
- Check backend logs for errors
- If endless "Reconnecting" → See [Endless Reconnecting Loop](#2-endless-reconnecting-loop)

---

### 4. Wrong Server Timezone

**How to Detect:**
```bash
# SSH into your server and check
timedatectl

# Shows something like:
       Local time: Tue 2024-02-19 02:55:00 UTC
# Instead of:
       Local time: Tue 2024-02-19 08:25:00 IST
```

**Why This Breaks Everything:**
```
Scheduler set to start at 8:55 AM
Server thinks it's 3:25 AM (UTC)
So scheduler NEVER triggers
Market opens at 9:00 AM IST but you're sleeping
When you finally check at 9:15 AM, feed hasn't started yet
```

**Quick Fix (Linux / DigitalOcean):**
```bash
ssh root@YOUR_SERVER_IP

# Set timezone to IST
sudo timedatectl set-timezone Asia/Kolkata

# Verify
timedatectl

# Should now show IST time:
# Local time: Tue 2024-02-19 08:25:00 IST
```

**Fix for Docker:**
Add to `docker-compose.yml`:
```yaml
services:
  backend:
    build: ./backend
    environment:
      TZ: Asia/Kolkata  # 🔥 Add this line
      ZERODHA_API_KEY: ${ZERODHA_API_KEY}
      # ... rest of config
```

Then restart:
```bash
docker-compose down
docker-compose up -d
```

**Fix for Dockerfile:**
```dockerfile
FROM python:3.10

# Add this line
ENV TZ=Asia/Kolkata

# Rest of Dockerfile...
```

**Verification:**
```bash
# Check timezone is set
cat /etc/timezone  # Should show "Asia/Kolkata"

# Restart docker/backend
# Log should show:
🌍 SERVER TIMEZONE CHECK
   ✅ SERVER TIMEZONE IS CORRECT (IST)
```

---

### 5. Network/Connectivity Issues

**Error Messages:**
```
Connection refused
Timeout connecting to kite.zerodha.com
socket.error: [Errno 111] Connection refused
```

**Check Server Internet:**
```bash
# From your server
curl -I https://kite.zerodha.com

# Should show:
HTTP/1.1 200 OK

# If timeout/refused, your server can't reach Zerodha
```

**Fixes to Try:**

**Option 1: Check Firewall**
```bash
# DigitalOcean firewall rules
# Portal: DigitalOcean → Firewalls
# Make sure "OUTBOUND" to port 443 is allowed
```

**Option 2: Check DNS**
```bash
# Test name resolution
nslookup kite.zerodha.com
# Or
dig kite.zerodha.com
```

**Option 3: ISP/Network Blocked (Rare)**
- Some ISPs block financial sites
- Contact your hosting provider
- Ask if Zerodha is accessible from your data center

**Option 4: Zerodha API Down (Very Rare)**
- Check: https://status.zerodha.com
- Wait for Zerodha to come back online
- Try again in 5 minutes

---

## ⏱️ Time-based Troubleshooting

### 8:45 AM - Pre-market Token Check

**Expected:**
```
⏰ [08:45:00 AM] PRE-MARKET TOKEN CHECK
✅ Token VALID - age: 15.3 hours
```

**If you see:**
```
🔴 TOKEN EXPIRED - CANNOT CONNECT
```
→ See [Token Expired](#1-token-expired)

---

### 8:50 AM - Feed Startup

**Expected:**
```
🚀 Starting market feed...
✅ Connected to Zerodha KiteTicker
📊 Subscribing to 3 tokens
✅ Market feed READY
```

**If you see:**
```
❌ Failed to start feed: Connection refused
```
→ See [Network/Connectivity Issues](#5-networkconnectivity-issues)

---

### 9:00-9:07 AM - Pre-open Phase

**Expected:**
```
🔄 MARKET STATUS CHANGE: PRE_OPEN
🟢 First tick received for NIFTY
```

**Often shows:**
```
⚠️ STALE FEED DETECTED - No ticks for 15 seconds
```

**Why:** 🟡 Normal - Pre-open has low tick frequency (expected)  
**No action needed**

---

### 9:07-9:15 AM - Freeze Phase

**Expected:**
```
🟡 Market in FREEZE phase (order matching)
📊 NIFTY: ₹19456.75 (last from pre-open)
```

**Note:** No new ticks expected  
Data is cached from pre-open phase  
This is NORMAL!

---

### 9:15 AM - Live Trading Begins

**Expected:**
```
🔄 MARKET STATUS CHANGE: FREEZE → LIVE
🟢 Live ticks resuming
📊 NIFTY: ₹19458.50 (updated)
```

**If still showing "Reconnecting...":**
1. Refresh browser (Cmd+R / Ctrl+R)
2. Wait 10 seconds
3. Should see live ticks
4. If not → Check logs for errors

---

### 3:30 PM - Market Close

**Expected:**
```
🔄 MARKET STATUS CHANGE: LIVE → CLOSED
🛑 Stopping market feed
📤 Backing up candles
```

**Note:** Feed stops after 3:30 PM  
Restarts next trading day at 8:55 AM  
This is correct behavior

---

## 🆘 Still Broken? Debugging Checklist

Run these commands to gather diagnostic info:

```bash
# 1. Check backend is running
ps aux | grep uvicorn

# 2. Check latest 50 log lines
tail -50 backend.log  # or docker logs

# 3. Check token is valid
cat backend/.env | grep ZERODHA_ACCESS_TOKEN

# 4. Check timezone
timedatectl | grep "Time zone"

# 5. Check Zerodha connectivity
curl -I https://kite.zerodha.com

# 6. Check Redis is running (if using Redis)
redis-cli ping
# Should show: PONG

# 7. Check port 8000 is open
netstat -tulpn | grep 8000
# Or: ss -tulpn | grep 8000

# 8. Check env file has all required vars
grep "ZERODHA" backend/.env
# Should show:
# ZERODHA_API_KEY=xxx
# ZERODHA_API_SECRET=xxx
# ZERODHA_ACCESS_TOKEN=xxx
```

---

## 📞 Error Message Reference

| Error | Cause | Fix |
|-------|-------|-----|
| `Token expired` | Token > 24 hours old | Run `python quick_token_fix.py` |
| `403 Forbidden` | Invalid/expired token | Refresh token (see above) |
| `Connection refused` | Backend not running / wrong port | Check `ps aux \| grep uvicorn` |
| `Network unreachable` | Server can't reach Zerodha | Check ISP/firewall |
| `timeout` | Zerodha API slow or down | Wait 5 min, check status.zerodha.com |
| `Reconnecting... (endless)` | Missing re-subscription (old code) | Update to latest code |
| `No data in cache` | Feed hasn't started | Wait until 8:55 AM, check token |

---

## ✅ Production Checklist Before Going Live

- [ ] Token refresh working (test at 8:45 AM)
- [ ] WebSocket reconnection with re-subscribe working
- [ ] Stale feed detection working (kill network, wait 30s)
- [ ] REST API fallback working (3x 403 errors triggers fallback)
- [ ] Timezone set to Asia/Kolkata
- [ ] Docker compose has `TZ=Asia/Kolkata` env var
- [ ] Zerodha API credentials correct in .env
- [ ] Redis running and accessible
- [ ] MySQL/DB running (if using state persistence)
- [ ] Logs clear at startup (no error spam)
- [ ] Frontend displays connection status correctly
- [ ] Tested full 9:00-9:15 AM transition (no false "reconnecting" messages)
- [ ] Tested network failure recovery
- [ ] Tested token expiration recovery

---

## 🎓 Key Takeaways

> The "Reconnecting to market feed…" message means:
>
> **NOT:** Your app is broken  
> **PROBABLY:** Your token expired  
> **OR:** Network issue  
> **OR:** Wrong server timezone  
> 
> **Solution:** Check backend logs (that's the real error)  
> **Never:** Restart the app - that won't fix expired token  
> **Always:** Refresh token via LOGIN button or `python quick_token_fix.py`

---

**Last Updated:** February 19, 2026  
**Version:** 2.0  
**Status:** Production Ready

