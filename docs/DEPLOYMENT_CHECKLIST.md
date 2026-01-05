# ✅ Implementation Checklist - State Orchestration System

## 📋 Pre-Deployment Verification

### Backend Components
- [x] Created `market_session_controller.py` - Time-based market status
- [x] Created `auth_state_machine.py` - Token validity tracking
- [x] Created `feed_watchdog.py` - WebSocket health monitoring
- [x] Created `system_health.py` router - Unified status API
- [x] Integrated watchdog with `market_feed.py`
- [x] Updated `main.py` to register health endpoints
- [x] All imports resolved (no circular dependencies)

### Frontend Components
- [x] Created `SystemStatusBanner.tsx` - Priority-based status display
- [x] Updated `page.tsx` to use new banner
- [x] Removed old token alert
- [x] Health polling every 10 seconds
- [x] Auto-login button on AUTH_REQUIRED

### Documentation
- [x] `STATE_ORCHESTRATION_SYSTEM.md` - Complete architecture
- [x] `QUICKSTART_ORCHESTRATION.md` - Quick start guide
- [x] `VISUAL_ARCHITECTURE.md` - Visual diagrams
- [x] `IMPLEMENTATION_SUMMARY.md` - Implementation details
- [x] Updated `README.md` with v2.0 features
- [x] Created `test_orchestration.py` - Component tests

---

## 🧪 Testing Steps

### 1. Test Components (Offline)
```bash
cd /path/to/mytradingSignal
python test_orchestration.py
```

**Expected Output**:
```
✅ Market Session Controller: WORKING
✅ Auth State Machine: WORKING  
✅ Feed Watchdog: WORKING
```

### 2. Start Backend
```bash
cd backend
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

**Look for**:
```
🐕 Feed Watchdog started
🟢 AUTH STATE: VALID (or EXPIRED)
✅ Connected to Zerodha KiteTicker
```

### 3. Test Health Endpoint
```bash
curl http://localhost:8000/api/system/health | jq
```

**Should return**:
```json
{
  "priority_status": "MARKET_SESSION",
  "market": { "phase": "LIVE" },
  "auth": { "state": "valid" },
  "feed": { "state": "connected" }
}
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

**Verify**:
- [ ] System status banner visible at top
- [ ] Banner color matches market status (green/blue/red/yellow)
- [ ] Login button appears if token expired
- [ ] Banner updates every 10 seconds
- [ ] Expandable details work (click health indicators)

### 6. Test Token Expiry Flow

**Simulate expired token**:
```bash
# Backup current token
cd backend
cp .env .env.backup

# Remove token
# Edit .env and set: ZERODHA_ACCESS_TOKEN=invalid_token

# Restart backend
# pkill -f uvicorn
uvicorn main:app --reload
```

**Expected behavior**:
1. Backend starts normally
2. First API call → 403 error
3. Auth State: EXPIRED
4. UI shows: 🔴 "Login Required" + Login Button
5. Watchdog stops attempting reconnects (waits for valid token)

**Restore token**:
```bash
mv .env.backup .env
# Token watcher should auto-detect and reconnect
```

### 7. Test Feed Stale Detection

**Simulate stale feed** (during market hours):
```bash
# Stop backend mid-trading session
pkill -f uvicorn
```

**Expected behavior**:
1. Feed continues for ~10 seconds (buffer)
2. Watchdog detects stale (no ticks)
3. UI shows: 🟡 "Reconnecting..."
4. Watchdog attempts auto-reconnect (5 attempts)

**Resume**:
```bash
cd backend
uvicorn main:app --reload
# Should reconnect automatically
```

---

## 🚀 Production Deployment Checklist

### Pre-Deployment
- [ ] All tests passing locally
- [ ] `.env` file configured with valid token
- [ ] Frontend env variables point to production backend
- [ ] Backend accessible from internet
- [ ] CORS configured for frontend domain

### DigitalOcean Setup
- [ ] Backend deployed and running
- [ ] Systemd service configured
- [ ] Firewall allows port 8000 (or your port)
- [ ] Domain/subdomain configured (if using)
- [ ] SSL certificate installed (recommended)

### Verify Production
```bash
# Test health endpoint
curl https://your-backend.com/api/system/health

# Should return:
# {"priority_status": "MARKET_SESSION", ...}
```

### Frontend Deployment
- [ ] Environment variables updated
- [ ] Build successful: `npm run build`
- [ ] Deployed to Vercel/Netlify/etc
- [ ] Can access: `https://your-frontend.com`

### Smoke Test
- [ ] Open frontend in browser
- [ ] Status banner visible
- [ ] WebSocket connects (see green indicator)
- [ ] Market data flowing
- [ ] Login button works (if needed)
- [ ] No errors in browser console
- [ ] No errors in backend logs

---

## 🔍 Post-Deployment Monitoring

### Daily Checks (Automated)

**Add to cron** (optional):
```bash
# Check system health every 5 minutes
*/5 * * * * curl -s https://your-backend.com/api/system/health/summary | jq '.healthy'

# Alert if unhealthy
*/5 * * * * curl -s https://your-backend.com/api/system/health/summary | jq -e '.healthy == false' && echo "ALERT: System unhealthy!"
```

### Manual Checks

**Every morning (8:00 AM)**:
```bash
# Verify token state
curl https://your-backend.com/api/system/health/auth

# Should show:
# {"state": "valid", "is_valid": true}

# If expired, login will auto-trigger at 9:00 AM
```

**During market hours (9:15 AM - 3:30 PM)**:
```bash
# Check feed health
curl https://your-backend.com/api/system/health/feed

# Should show:
# {"state": "connected", "is_healthy": true}
```

**After market (3:30 PM+)**:
```bash
# Check market phase
curl https://your-backend.com/api/system/health/market

# Should show:
# {"phase": "CLOSED"}
```

### Log Monitoring

**Watch backend logs**:
```bash
# DigitalOcean
journalctl -u trading-backend -f

# Look for:
# ✅ No repeated "AUTH STATE: EXPIRED"
# ✅ No "FEED STATE: STALE" loops
# ✅ Tick counts increasing
```

---

## 🆘 Troubleshooting Checklist

### Issue: Login button doesn't disappear

**Check**:
```bash
# 1. Verify token exists
cat backend/.env | grep ZERODHA_ACCESS_TOKEN

# 2. Check auth state
curl http://localhost:8000/api/system/health/auth

# 3. Verify with Zerodha API
curl -X POST http://localhost:8000/api/system/health/auth/verify
```

**Fix**:
```bash
python backend/quick_token_fix.py
```

---

### Issue: "Reconnecting..." keeps showing

**Check**:
```bash
# 1. Check feed state
curl http://localhost:8000/api/system/health/feed

# 2. If stale, check auth first
curl -X POST http://localhost:8000/api/system/health/auth/verify

# 3. Check backend logs
journalctl -u trading-backend -n 50
```

**Common causes**:
- Token expired → Run `quick_token_fix.py`
- Network issue → Check connectivity
- Zerodha API down → Wait or check status.zerodha.com

---

### Issue: Wrong market status showing

**Check**:
```bash
# 1. Verify server time and timezone
date
# Should show IST

# 2. Check market phase
curl http://localhost:8000/api/system/health/market
```

**Fix**:
```bash
# Set timezone to IST
sudo timedatectl set-timezone Asia/Kolkata
```

---

### Issue: Backend keeps restarting

**This should NOT happen anymore**, but if it does:

**Check**:
```bash
# System logs
journalctl -u trading-backend -n 100

# Look for:
# - Python exceptions
# - Import errors
# - Port conflicts
```

**Fix**:
```bash
# Verify all dependencies installed
cd backend
pip install -r requirements.txt

# Check port 8000 is free
lsof -i :8000
```

---

## 📊 Success Indicators

Your system is working correctly if:

✅ **Backend uptime**: Days (not hours)  
✅ **Manual restarts**: 0 per day  
✅ **Login required**: Max 1 per day (morning)  
✅ **Feed reconnects**: Automatic (no action needed)  
✅ **Status accuracy**: Always shows correct phase  
✅ **Error recovery**: Handles token expiry gracefully  

---

## 🎯 Key Metrics to Track

| Metric | Target | Check |
|--------|--------|-------|
| Backend Uptime | >99% | `uptime` or systemd |
| Token Age | <22 hours | `/api/system/health/auth` |
| Feed Quality | >90% | `/api/system/health/feed` |
| Reconnect Count | <5/day | `/api/system/health/feed` |
| Manual Interventions | 0/day | Your logs |

---

## 🏁 Final Verification

### All Systems Go ✅

Run this complete check:

```bash
#!/bin/bash

echo "🧪 Complete System Check"
echo "======================="

# 1. Backend health
echo "1. Backend Health..."
curl -s http://localhost:8000/api/system/health/summary | jq

# 2. Market status
echo "2. Market Status..."
curl -s http://localhost:8000/api/system/health/market | jq '.phase'

# 3. Auth status
echo "3. Auth Status..."
curl -s http://localhost:8000/api/system/health/auth | jq '.state'

# 4. Feed status
echo "4. Feed Status..."
curl -s http://localhost:8000/api/system/health/feed | jq '.state'

# 5. WebSocket test
echo "5. WebSocket..."
# Open http://localhost:3000 and check for green status

echo ""
echo "✅ All checks complete"
```

**Expected Output**:
```json
{
  "healthy": true,
  "market_phase": "LIVE",
  "auth_valid": true,
  "feed_healthy": true
}
"LIVE"
"valid"
"connected"
```

---

## 📚 Documentation Quick Reference

| Document | Purpose |
|----------|---------|
| `STATE_ORCHESTRATION_SYSTEM.md` | Complete architecture |
| `QUICKSTART_ORCHESTRATION.md` | Quick start guide |
| `VISUAL_ARCHITECTURE.md` | Diagrams and flows |
| `IMPLEMENTATION_SUMMARY.md` | What was built |
| `test_orchestration.py` | Component tests |
| `README.md` | Project overview |

---

## ✅ Deployment Sign-Off

- [ ] All tests passing
- [ ] Local testing complete
- [ ] Production deployed
- [ ] Health checks passing
- [ ] Documentation reviewed
- [ ] Monitoring configured
- [ ] Team notified

**Deployed By**: _________________  
**Date**: _________________  
**Version**: 2.0.0  
**Status**: 🟢 PRODUCTION READY

---

**Need Help?**

1. Check `/api/system/health` first
2. Review logs: `journalctl -u trading-backend -f`
3. Refer to [STATE_ORCHESTRATION_SYSTEM.md](./docs/STATE_ORCHESTRATION_SYSTEM.md)

**System Status**: 🟢 All Systems Operational
