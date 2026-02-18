# OI Momentum Signals Showing ₹0.00 - TROUBLESHOOTING GUIDE

## The Problem: ₹0.00 and NO_SIGNAL

You're seeing this on the dashboard:

```
⚠️ NIFTY 50
₹0.00 (EMPTY!)
NO SIGNAL (EMPTY!)
NO CONFIDENCE 0%
⚡ Waiting for live market data - accumulating candles for analysis
```

This means: **The frontend is NOT receiving price data from the backend API.**

---

## Root Causes (In Order of Likelihood)

### 🔴 CAUSE #1: Zerodha Token Expired (Most Common)
- Zerodha tokens expire every 24 hours
- Without a valid token, WebSocket can't connect
- No data flows → ₹0.00 on frontend

**Quick Check**:
```bash
python backend/check_oi_momentum_status.py
```
Look for: `Authenticated: ✅ YES` or `❌ NO`

**Fix**:
```bash
# Option A: Click LOGIN in UI (recommended)
# Option B: Refresh token from command line
python backend/quick_token_fix.py
```

---

### 🔴 CAUSE #2: Market is Closed
- Market hours: 9:15 AM - 3:30 PM IST, weekdays only
- Outside these hours: No data is fetched
- timestamp shows 5:10 PM = **MARKET CLOSED**

**Your Screenshot Shows**: `Updated: 5:10:55 PM`
- Market closed at 3:30 PM
- It's now 5:10 PM = 1 hour 40 minutes AFTER close
- **This is completely normal behavior!**

**What to Do**:
- Wait for market to open at **9:15 AM tomorrow**
- During closed hours, cached data from last session shows (but updates don't happen)

---

### 🔴 CAUSE #3: WebSocket Disconnected
- Feed should be running in background
- Something caused it to disconnect
- Market data not being received from Zerodha

**Quick Check**:
```bash
python backend/watch_oi_momentum.py
```
Look for: Candle count increasing

**If Stuck**:
```bash
# Restart the backend
# Terminal 1: Stop current backend (Ctrl+C)
# Terminal 2: Start fresh
cd backend
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

---

### 🔴 CAUSE #4: Redis Cache Down
- Market data stored in Redis
- If Redis disconnected: cache returns empty
- Frontend gets no price data

**Check**:
```bash
python backend/diagnose_system.py
```
Look for: `Redis connected and working: ✅`

**Fix**:
```bash
# Verify Redis is running
redis-cli ping
# Should return: PONG

# If not running, start it
# (Depends on your setup)
```

---

### 🔴 CAUSE #5: Backend Crashed or Not Running
- If backend service not running: API returns nothing
- Frontend can't fetch data

**Check**:
```bash
curl http://localhost:8000/health
# Should return: {"status": "ok"}
```

**If Failed**, restart backend:
```bash
cd backend
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

---

## Step-by-Step Diagnosis (Do This Now)

### Step 1: Check Market Hours (5 seconds)
```
💭 What time is it?
   Your screenshot: 5:10:55 PM
   
   Is it between 9:15 AM - 3:30 PM IST?
   ❌ NO → Market closed, wait for tomorrow at 9:15 AM
   ✅ YES → Continue to Step 2
```

If market is **CLOSED**, this is normal. Data won't flow until 9:15 AM.

### Step 2: Check Authentication (30 seconds)
```bash
cd backend
python check_oi_momentum_status.py
```

**Look for line**:
```
1️⃣ AUTHENTICATION STATUS
   Authenticated: ✅ YES    ← GOOD
   Authenticated: ❌ NO     ← PROBLEM! → Fix next
```

**If ❌ NO**:
```bash
# Fix token NOW
python quick_token_fix.py
# Then go back to Step 2
```

### Step 3: Check System Health (1 minute)
```bash
python diagnose_system.py
```

**Look for section**: `7️⃣ DIAGNOSIS & RECOMMENDATIONS`

**Expected results**:
```
✅ ALL SYSTEMS OPERATIONAL
   • Market data: Flowing
   • Candles: Loaded
   • Signals: Should be active
```

**If not**, check recommendations in diagnostic output.

### Step 4: Test API Responses (1 minute)
```bash
python test_api_responses.py
```

**Look for**: Prices showing, not ₹0.00

**If all ₹0.00**, then:
```
API endpoints returning ₹0.00
    ↓
Backend cache has no data
    ↓
WebSocket not connected OR market closed
    ↓
Check diagnose_system.py output again
```

### Step 5: Check Backend Logs
```bash
# If backend running in another terminal, check its output
# Look for errors like:
#   ❌ Zerodha connection failed
#   ❌ Token invalid
#   ❌ WebSocket disconnected

# Watch logs in real-time:
python watch_oi_momentum.py
```

---

## Quick Fixes by Scenario

### Scenario A: Market is Closed (5:10 PM in your case)
```
Reality Check: Market closed at 3:30 PM
              It's 5:10 PM = 1 hour 40 min AFTER close
              
Fix: Wait for tomorrow, 9:15 AM
Current behavior is 100% NORMAL ✓
```

### Scenario B: Market Open But ₹0.00
```
Issue: Token expired

Fix:
1. python quick_token_fix.py
2. python check_oi_momentum_status.py
3. Verify: Authenticated: ✅ YES
```

### Scenario C: Authenticated But Still ₹0.00
```
Issue: WebSocket disconnected or Redis down

Fix:
1. python diagnose_system.py
2. Check section "4️⃣ MARKET DATA IN CACHE"
3. If "❌ NO DATA", WebSocket issue
4. Restart backend:
   - Kill current process (Ctrl+C)
   - uvicorn main:app --reload
```

### Scenario D: During Market Hours, Should Have Data
```
Issue: Some system component broken

Fix:
1. python diagnose_system.py
2. Read "7️⃣ DIAGNOSIS & RECOMMENDATIONS"
3. Follow instructions for your issue
```

---

## Understanding the ₹0.00 Display

### What's Happening in Frontend Code

**OIMomentumCard.tsx**:
```javascript
const response = await fetch(`/api/oi-momentum/${symbol}`);
const data = await response.json();

// Shows the price:
<div className="text-xs">₹{data.current_price?.toFixed(2) ?? '0.00'}</div>
```

**When price is ₹0.00, it means**:
1. API returned `current_price: 0` or `undefined`
2. Which happens when backend cache has no market data
3. Which happens when WebSocket isn't receiving ticks

### How It SHOULD Work

```
Zerodha WebSocket
       ↓
Receives tick: NIFTY ₹19,200.50
       ↓
Redis Cache: market:NIFTY = {price: 19200.50, ...}
       ↓
Frontend API fetch: /api/oi-momentum/NIFTY
       ↓
Backend fetches from cache: ₹19,200.50
       ↓
Frontend receives: {current_price: 19200.50, ...}
       ↓
Displays: ₹19,200.50 ✓
```

**When you see ₹0.00, the chain is BROKEN somewhere.**

---

## Command Reference

### For Diagnosis
```bash
# One-time status snapshot
python check_oi_momentum_status.py

# Complete system diagnostic
python diagnose_system.py

# Test API responses
python test_api_responses.py

# Live monitoring (refreshes every 5s)
python watch_oi_momentum.py
```

### For Fixes
```bash
# Refresh Zerodha token
python quick_token_fix.py

# Test candle backup system
python test_candle_backup.py

# Clear cache and restart
python -c "from services.cache import CacheService; import asyncio; asyncio.run(CacheService().connect().then(lambda: cache.flush_all()))"

# Restart backend (in backend directory)
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### For API Testing
```bash
# Check system health
curl http://localhost:8000/health

# Get market data
curl http://localhost:8000/api/market/snapshot

# Get OI Momentum signals
curl http://localhost:8000/api/oi-momentum/all

# Get full diagnostic
curl http://localhost:8000/api/diagnostics/oi-momentum-debug | jq
```

---

## Most Common Answer

**Question**: "Why is my OI Momentum showing ₹0.00 and NO_SIGNAL?"

**Answer**: Usually one of these:

1. **🕐 Market Closed** (Most likely in your case)
   - Check time: Is it between 9:15 AM - 3:30 PM IST?
   - If NO: Wait for market to open tomorrow
   - If YES: Continue to next check

2. **🔐 Token Expired**
   - Run: `python quick_token_fix.py`
   - Then wait 2-3 minutes for data to flow

3. **💻 Backend Not Running**
   - Check: `curl http://localhost:8000/health`
   - If fails: Start backend with `uvicorn main:app --reload`

4. **📡 WebSocket Disconnected**
   - Run: `python watch_oi_momentum.py`
   - If no candle count increasing: Restart backend

---

## Checklist for ₹0.00 Issue

- [ ] Market open? (9:15 AM - 3:30 PM IST, Mon-Fri)
  - If NO: Expected behavior, wait for market open
  - If YES: Continue

- [ ] Backend running? (`curl http://localhost:8000/health`)
  - If NO: Start it: `uvicorn main:app --reload`
  - If YES: Continue

- [ ] Authenticated? (`python check_oi_momentum_status.py`)
  - If NO: Run `python quick_token_fix.py`
  - If YES: Continue

- [ ] Market data in cache? (`python diagnose_system.py`)
  - If NO: WebSocket issue, restart backend
  - If YES: Signals should appear

- [ ] Candles accumulated? (Look for 20+)
  - If NO: Wait 5-10 minutes during market hours
  - If YES: Signals should be active

---

## Your Current Situation

**What you showed**:
```
Timestamp: 5:10:55 PM
Prices: ₹0.00 for all symbols
Signal: NO_SIGNAL for all
Confidence: 0% for all
```

**Analysis**:
- ⏰ Time is 5:10 PM (after 3:30 PM market close)
- 📊 No price data (₹0.00)
- 🔴 No signals (NO_SIGNAL)

**Verdict**: **COMPLETELY NORMAL FOR CLOSED MARKET** ✓

**What to do**:
1. Wait for tomorrow at 9:15 AM for market to open
2. At 9:15 AM, prices will update to live values
3. Signals will activate within 10-15 minutes
4. Dashboard will show real BUY/SELL signals

---

## Debug During Market Hours Only

These tools work best **during market hours (9:15 AM - 3:30 PM)**:
- `watch_oi_momentum.py` - Shows real-time updates
- `test_api_responses.py` - Shows live data flowing
- `diagnose_system.py` - Checks active systems

Outside market hours, these show cached data only (which is expected).

---

## Summary

| Symptom | Cause | Fix |
|---------|-------|-----|
| ₹0.00 + Closed market (5 PM) | Normal closed hours | Wait for 9:15 AM |
| ₹0.00 + Market open time | Token expired | `quick_token_fix.py` |
| ₹0.00 + Authenticated | WebSocket down | Restart backend |
| ₹0.00 + All options checked | Redis issue | Check Redis running |

**Your case**: ₹0.00 + 5:10 PM = **NORMAL** ✓

Run diagnostics again tomorrow during market hours to verify everything works!
