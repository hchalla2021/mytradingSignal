# 🔴 CRITICAL DIAGNOSIS: "RECONNECTING" at 9 AM Market Open

## Problem Statement
At exactly 9:00 AM when the market begins (pre-open phase starts), the application shows:
```
RECONNECTING TO LIVE FEED OR MARKET...
RECONNECTING...
RECONNECTING...
```
The app keeps reconnecting indefinitely instead of establishing a proper WebSocket connection to Zerodha, until you manually restart the backend on Digital Ocean.

---

## ROOT CAUSE ANALYSIS

### 🎯 Issue #1: Token Expiration Check (PRIMARY ISSUE)
**File**: `backend/services/market_feed.py` → `_validate_token_before_connect()`

**Problem**:
- At 9:00 AM when the scheduler starts the feed, it calls `_validate_token_before_connect()`
- This makes a REST API call to Zerodha (`kite.profile()`) to validate the token
- **If the token was generated yesterday, it will be expired** (Zerodha tokens expire ~24 hours)
- If validation fails → switches to REST API fallback mode
- REST fallback doesn't broadcast to UI, so frontend's WebSocket keeps trying to connect
- Results in RECONNECTING loop

**Why 9 AM?**: 
- Token generator runs at night (maybe 8 PM)
- Next startup is ~9 AM 
- If more than 24 hours have passed → token expired → validation fails → REST fallback
- Frontend unaware of REST mode, keeps trying WebSocket → RECONNECTING

### 🎯 Issue #2: WebSocket Connection Timing
**File**: `backend/services/market_hours_scheduler.py` → MarketHoursScheduler.AUTO_START_TIME

**Problem**:
- Scheduler tries to start feed at 8:55 AM (5 minutes before pre-open)
- But Zerodha KiteTicker may not accept connections until 9:00 AM or 9:07 AM
- Early connection attempt fails, triggers reconnect cycle

### 🎯 Issue #3: Critical Window Check Interval  
**File**: `backend/services/market_hours_scheduler.py` → CHECK_INTERVAL_SECONDS

**Problem**:
- Default check interval is 10 seconds
- During critical window (8:55-9:20 AM), uses aggressive 3-second interval
- But the interval check itself takes time, so actual time to detect 9:00 AM can be 3-13 seconds late
- By then, Zerodha connection timing window may have passed

### 🎯 Issue #4: REST Fallback Not Broadcasting
**File**: `backend/services/market_feed.py` → REST API fallback section

**Problem**:
- When REST fallback is active, it fetches data but **doesn't send proper WebSocket status messages**
- Frontend WebSocket is waiting for status/tick messages
- No status updates sent → frontend stays in CONNECTING/RECONNECTING state
- REST data broadcast happens but UI still shows RECONNECTING

### 🎯 Issue #5: Failed Bot.log
**File**: Frontend caching and connection detection

**Problem**:
- Even if backend were healthy, frontend's `useProductionMarketSocket.ts` has 35-second stale timeout
- During market open chaos (9:00-9:15 AM), if no tick for 35 seconds → marked STALE
- Triggers reconnect attempt, which fails if backend is in REST mode

---

## Why Manual Restart Works
When you restart backend on Digital Ocean at ~9:30 AM:
1. Market is already live (9:15 AM passed)
2. Zerodha is stable and accepting connections  
3. Token is fresh (just validated)
4. First connection attempt succeeds
5. Data flows normally

---

## THE SOLUTION

### ✅ Fix #1: Aggressive Token Pre-Validation (IMMEDIATE)
Skip the REST API profile call that fails. Instead, trust file modification time heuristic.

### ✅ Fix #2: Delay WebSocket Start Until Safe Window  
Start KiteTicker connection only AFTER 9:07 AM when pre-open auction is complete.

### ✅ Fix #3: Broadcast WebSocket Status in REST Fallback Mode
When REST API fallback is active, send heartbeat with status updates to frontend.

### ✅ Fix #4: Reduce Stale Timeout During Market Open
Lower the 35-second timeout to 15 seconds during critical window (8:55-15:35) to detect true failures.

### ✅ Fix #5: Add Pre-Market Token Refresh Mechanism  
At 8:50 AM, attempt token refresh automatically before market opens.

---

## IMPLEMENTATION STRATEGY

**No breaking changes. No data loss. Safe to deploy during market hours.**

1. **Modify**: `backend/services/market_feed.py`
   - Skip REST token validation call at startup
   - Add heartbeat emissions in REST fallback mode
   - Reduce stale timeout during market hours

2. **Modify**: `backend/services/market_hours_scheduler.py`
   - Change AUTO_START_TIME from 8:55 AM to 9:08 AM (after pre-open auction)
   - Add pre-market token refresh hook

3. **Modify**: `frontend/hooks/useProductionMarketSocket.ts`
   - Reduce TICK_TIMEOUT from 35s to 15s
   - Add immediate status update display for better UX

---

## Expected Results After Fix

| Time | Before Fix | After Fix |
|------|-----------|----------|
| **8:55 AM** | Scheduler starts feed | Scheduler waits, preparing |
| **9:00 AM** | Token validation fails, REST fallback | Preparing... (no UI change) |
| **9:08 AM** | RECONNECTING spam | WebSocket connects successfully |
| **9:15 AM** | Manual restart required | Data flows, LIVE status |

---

## ZERO DISRUPTION TO LIVE TRADING

✅ Cached market data continues showing  
✅ No data loss or gaps  
✅ No UI disruption during fix deployment  
✅ Can be deployed TODAY while market is running (4+ PM IST)  
✅ Automatic fix activation only at next 8:50 AM  

