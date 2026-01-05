# 🚀 Quick Start - Production-Grade Trading System

## ✅ What Was Fixed

**PROBLEM**: Manual backend restart required daily when token expires  
**SOLUTION**: Professional state orchestration with auto-recovery

---

## 🎯 New Features

✅ **Zero Manual Restarts** - Backend runs 24/7 without intervention  
✅ **Auto Token Detection** - Knows when token expires  
✅ **Auto Reconnection** - WebSocket self-heals  
✅ **Smart UI** - Shows exactly what's wrong and how to fix it  
✅ **Professional Monitoring** - Track all 3 states independently  

---

## 🏃 Quick Start (2 Minutes)

### 1. Install Dependencies
```bash
cd backend
pip install -r requirements.txt

cd ../frontend
npm install
```

### 2. Test Components
```bash
# From project root
python test_orchestration.py
```

You should see:
```
✅ Market Session Controller: WORKING
✅ Auth State Machine: WORKING
✅ Feed Watchdog: WORKING
```

### 3. Start Backend
```bash
cd backend
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Look for these messages:
```
🐕 Feed Watchdog started
🟢 AUTH STATE: VALID (or EXPIRED if token old)
🔧 Initializing KiteTicker...
```

### 4. Start Frontend
```bash
cd frontend
npm run dev
```

### 5. Open Browser
```
http://localhost:3000
```

**What you'll see**:
- 🟢 Green banner = Market LIVE (during market hours)
- 🔵 Blue banner = PRE_OPEN (9:00-9:15 AM)
- 🔴 Red banner = Login Required (if token expired)
- 🟡 Yellow banner = Reconnecting (if feed issue)

---

## 🔑 First-Time Login

If you see **"Login Required"** banner:

1. Click **"Login Now"** button
2. Zerodha popup opens
3. Login with Zerodha credentials
4. Token auto-saved to `.env`
5. Backend auto-reconnects
6. Page auto-refreshes (15s)

**Done!** No backend restart needed.

---

## 📊 Verify System Health

### Check All States
```bash
curl http://localhost:8000/api/system/health | jq
```

**Expected response**:
```json
{
  "priority_status": "MARKET_SESSION",
  "market": {
    "phase": "LIVE",
    "is_trading_hours": true
  },
  "auth": {
    "state": "valid",
    "is_valid": true
  },
  "feed": {
    "state": "connected",
    "is_healthy": true
  }
}
```

### Quick Health Check
```bash
curl http://localhost:8000/api/system/health/summary
```

**Healthy system**:
```json
{
  "healthy": true,
  "market_phase": "LIVE",
  "auth_valid": true,
  "feed_healthy": true,
  "requires_action": false
}
```

---

## 🕒 Daily Flow (Automated)

### Morning (5:00-9:00 AM)
```
05:00 → Token expires (Zerodha daily reset)
      ↓
      UI shows: 🔴 "Login Required"
      ↓
      You click LOGIN (takes 30 seconds)
      ↓
      Token saved → Auto-reconnect
      ↓
09:00 → Market Status: PRE_OPEN
      ↓
      UI shows: 🔵 "Pre-Open Session"
```

### Market Hours (9:15-3:30 PM)
```
09:15 → Market Status: LIVE
      ↓
      Feed Watchdog monitors (every 3s)
      ↓
      If no data for 10s → Auto-reconnect
      ↓
      All automatic, no action needed
```

### After Hours (3:30 PM+)
```
15:30 → Market Status: CLOSED
      ↓
      Backend keeps running
      ↓
      Ready for next day
```

**No manual restart at any point** ✅

---

## 🐛 Troubleshooting

### Issue: "Login Required" banner won't go away

**Check token**:
```bash
cd backend
cat .env | grep ZERODHA_ACCESS_TOKEN
```

**If missing or old**:
```bash
python quick_token_fix.py
```

**Verify**:
```bash
curl -X POST http://localhost:8000/api/system/health/auth/verify
```

---

### Issue: "Reconnecting..." keeps showing

**Check feed state**:
```bash
curl http://localhost:8000/api/system/health/feed
```

**If `state: "stale"` or `state: "error"`**:
1. Check token validity first
2. Check network connectivity
3. Check backend logs for errors

**Backend logs should show**:
```
🟢 First tick received for NIFTY
🟢 First tick received for BANKNIFTY
```

**If you see**:
```
❌ Zerodha error: 403
🔴 ZERODHA ACCESS TOKEN ERROR
```

Token is invalid → Run `quick_token_fix.py`

---

### Issue: Wrong market status

**Verify time and timezone**:
```bash
curl http://localhost:8000/api/system/health/market
```

**Should show**:
- `phase: "PRE_OPEN"` (9:00-9:07 AM IST)
- `phase: "AUCTION_FREEZE"` (9:07-9:15 AM IST)  
- `phase: "LIVE"` (9:15 AM-3:30 PM IST)
- `phase: "CLOSED"` (other times)

**If wrong**: Server timezone may not be IST

**Fix**:
```bash
# Linux/DigitalOcean
sudo timedatectl set-timezone Asia/Kolkata
```

---

## 🔍 Monitoring

### Watch Backend Logs
```bash
cd backend
uvicorn main:app --reload | grep -E "AUTH STATE|FEED STATE|MARKET"
```

**Look for**:
```
🟢 AUTH STATE: VALID
🟢 FEED STATE: CONNECTED
📊 Market Phase: LIVE
```

### Watch Feed Health
```bash
watch -n 5 'curl -s http://localhost:8000/api/system/health/feed | jq'
```

### Monitor Connection Quality
```bash
curl http://localhost:8000/api/system/health | jq '.feed.connection_quality'
```

**100% = Perfect**  
**90-99% = Good**  
**<90% = Check logs**

---

## 📱 Mobile Testing

### Test from phone (same network)

**Find your IP**:
```bash
# Windows
ipconfig | findstr IPv4

# Linux/Mac
ifconfig | grep "inet "
```

**Update frontend env**:
```bash
# frontend/.env.local
NEXT_PUBLIC_API_URL=http://YOUR_IP:8000
NEXT_PUBLIC_WS_URL=ws://YOUR_IP:8000/ws/market
```

**Access from phone**:
```
http://YOUR_IP:3000
```

---

## 🚀 Production Deployment (DigitalOcean)

### Backend Setup

1. **Install on server**:
```bash
cd /path/to/backend
pip install -r requirements.txt
```

2. **Systemd service** (already exists):
```bash
sudo systemctl enable trading-backend
sudo systemctl start trading-backend
```

3. **Check health**:
```bash
curl http://localhost:8000/api/system/health/summary
```

### ✅ That's it!

**No more**:
- ❌ Manual restarts
- ❌ Cron jobs
- ❌ SSH maintenance
- ❌ Token refresh scripts

**System handles**:
- ✅ Token expiry
- ✅ WebSocket failures
- ✅ Market transitions
- ✅ Network issues

---

## 🎯 Key URLs

| Endpoint | Purpose |
|----------|---------|
| `/api/system/health` | Full system status |
| `/api/system/health/market` | Market session only |
| `/api/system/health/auth` | Auth state only |
| `/api/system/health/feed` | Feed health only |
| `/api/system/health/summary` | Quick health check |
| `/api/system/health/auth/verify` | Test token with Zerodha |

---

## 💡 Pro Tips

### 1. Monitor health endpoint
Add to your monitoring:
```bash
*/5 * * * * curl -s http://localhost:8000/api/system/health/summary | jq '.healthy'
```

### 2. Check logs periodically
```bash
journalctl -u trading-backend -f --since today
```

### 3. Test token before market
```bash
# Run at 8:00 AM daily
curl -X POST http://localhost:8000/api/system/health/auth/verify
```

### 4. Bookmark login URL
```
http://localhost:8000/api/auth/login
```

Open this daily at 8:00 AM to refresh token preemptively.

---

## 📚 Documentation

- **Full Architecture**: `docs/STATE_ORCHESTRATION_SYSTEM.md`
- **API Reference**: `http://localhost:8000/docs` (FastAPI auto-docs)
- **Component Tests**: `test_orchestration.py`

---

## 🏆 Success Indicators

Your system is working perfectly if:

✅ Backend uptime: Days (not hours)  
✅ Manual restarts: Zero  
✅ Token errors: Auto-handled  
✅ Feed reconnects: Automatic  
✅ UI always shows correct status  
✅ Login required max once per day  

---

## 🆘 Emergency Commands

### Force auth refresh
```bash
python backend/quick_token_fix.py
```

### Restart backend (if absolutely needed)
```bash
sudo systemctl restart trading-backend
```

### Check if backend is running
```bash
sudo systemctl status trading-backend
```

### View real-time logs
```bash
sudo journalctl -u trading-backend -f
```

---

## ✅ You're Done!

Your trading system is now:
- 🏆 Production-grade
- 🤖 Self-healing
- 📊 Professional
- 🚀 Zero-maintenance

**Just login once per day when prompted. That's it.**

---

**Need Help?**  
Check `/api/system/health` first - it tells you exactly what's wrong.

**Status**: 🟢 PRODUCTION READY
