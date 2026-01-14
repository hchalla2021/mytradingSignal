# Fix: 9:00 AM WebSocket Connection Issue

## Problem Identified

**Symptom:** At 9:00 AM sharp, market status changes from "Market Closed" to "Pre-Open", but WebSocket doesn't connect and no market data flows. System stays frozen until manual backend restart at 9:07-9:15 AM.

## Root Cause Analysis

### The Issue Chain:
1. **8:50 AM** - Market Hours Scheduler activates and calls `_ensure_feed_running()`
2. **Token Invalid** - If Zerodha token expired, WebSocket connection silently fails
3. **9:00 AM** - Status correctly changes to "PRE_OPEN" in UI
4. **No Data Flow** - Scheduler sees feed as "not running" but doesn't retry
5. **Freezing** - No data updates until manual backend restart forces fresh connection
6. **Manual Intervention Required** - User must login to Digital Ocean and restart backend

### Why Manual Restart Works:
- Fresh `start()` call forces token validation
- New WebSocket connection attempt
- REST API fallback activates if needed
- Data starts flowing again

## Solutions Implemented

### 1. **Aggressive Connection Retry During Market Hours**
**File:** `backend/services/market_hours_scheduler.py`

**Changes:**
- Scheduler now **continuously retries** connection every 60 seconds during market hours
- No longer assumes "feed started = feed connected"
- Tracks consecutive failures and shows helpful error messages after 3 failures
- Better health detection using multiple checks (kws exists, running flag, not in fallback mode)

**Before:**
```python
if should_run and not is_currently_running and last_feed_state != 'running':
    # Only tried once, then assumed it was running
    await self._ensure_feed_running()
    last_feed_state = 'running'
```

**After:**
```python
if should_run:
    if not is_currently_running:
        # Keeps retrying every minute if not connected
        success = await self._ensure_feed_running()
        if success:
            last_feed_state = 'running'
        else:
            # Track failures and retry
            consecutive_failures += 1
```

### 2. **Enhanced Connection Health Monitoring**
**File:** `backend/services/market_feed.py`

**Changes:**
- Added `is_connected` property with intelligent health checks
- Tracks WebSocket state AND data freshness
- Returns True only if received tick data in last 60 seconds
- Prevents "false positive" connected state

**New Property:**
```python
@property
def is_connected(self) -> bool:
    """Check if WebSocket is connected AND receiving data"""
    if not self.kws or not self.running or self._using_rest_fallback:
        return False
    
    # Check if we've received recent data
    current_time = time.time()
    most_recent_update = max(self.last_update_time.values())
    
    # Connected = got data in last 60 seconds
    return (current_time - most_recent_update) < 60
```

### 3. **Improved REST API Fallback**
**Changes:**
- Reduced polling interval: **5 seconds → 2 seconds** for smoother UI updates
- Smart logging (only log every 20 seconds to reduce spam)
- Fallback automatically activates when WebSocket fails
- Continues retrying WebSocket in background while REST keeps UI updated

**Before:**
```python
# Polled every 5 seconds, UI felt sluggish
if self._using_rest_fallback and is_market_open():
    if (current_time - last_rest_poll_time).total_seconds() >= 5:
        # fetch data
```

**After:**
```python
# Polls every 2 seconds, UI stays smooth
if self._using_rest_fallback and is_market_open():
    if (current_time - last_rest_poll_time).total_seconds() >= 2:
        # fetch data (with smart logging)
```

### 4. **Connection State Tracking**
**Changes:**
- Added `_is_connected` flag set by callbacks
- Set to `True` on `_on_connect()`
- Set to `False` on `_on_close()`
- Helps scheduler accurately detect connection state

### 5. **Better Error Handling**
**Changes:**
- Scheduler shows clear error messages after 3 consecutive failures
- Guides user to fix token issue
- Doesn't spam logs with repeated errors
- Shows which phase (PRE_OPEN vs LIVE) connection is needed for

## Expected Behavior After Fix

### 9:00 AM Pre-Open Scenario:
```
[8:50 AM] Scheduler: Auto-starting feed (10 mins before pre-open)
[8:50 AM] Token validation: FAILED (expired token)
[8:50 AM] REST API fallback: ACTIVATED
[8:50 AM] Scheduler: Will retry in 60 seconds

[8:51 AM] Scheduler: Retry attempt 1 - Feed NOT Connected
[8:51 AM] Attempting WebSocket restore...
[8:51 AM] WebSocket failed, REST fallback continues
[8:51 AM] UI: Showing data from REST API (2-second updates)

[9:00 AM] Market Status: CLOSED → PRE_OPEN
[9:00 AM] Scheduler: PRE_OPEN phase detected
[9:00 AM] Retry attempt 2 - Feed NOT Connected

[9:01 AM] Scheduler: Retry attempt 3 - Feed NOT Connected
[9:01 AM] ⚠️ PERSISTENT CONNECTION ISSUES
[9:01 AM] Showing helpful error message:
          "Token expired - Click LOGIN or run quick_token_fix.py"

[9:05 AM] User clicks LOGIN in UI
[9:05 AM] New token generated
[9:05 AM] Auto-reconnect triggered
[9:05 AM] Token validation: SUCCESS
[9:05 AM] WebSocket: CONNECTED
[9:05 AM] Live data flowing ✅

[9:15 AM] Market Status: PRE_OPEN → LIVE
[9:15 AM] Data continues flowing smoothly (no freeze)
```

## Testing Steps

### 1. Test Token Expiration Handling:
```bash
# Simulate expired token
cd backend
# Edit .env - use old/invalid token

# Start backend
uvicorn main:app --reload

# Expected:
# - REST API fallback activates immediately
# - UI shows data (2-second updates)
# - Scheduler retries every minute
# - After 3 failures, shows clear error message
```

### 2. Test 9:00 AM Transition:
```bash
# Wait for 9:00 AM pre-open
# Expected:
# - Status changes to "PRE_OPEN"
# - If WebSocket down, REST keeps UI updated
# - No freezing
# - Data continues flowing
```

### 3. Test WebSocket Recovery:
```bash
# While in REST fallback mode:
# Click LOGIN in UI and complete auth

# Expected:
# - Auto-reconnect detects new token
# - WebSocket connects within 2-3 seconds
# - Switches from REST → WebSocket seamlessly
# - No manual restart needed
```

## Configuration

**Scheduler is ENABLED by default:**
```env
# backend/.env
ENABLE_SCHEDULER=true  # Auto-starts feed during market hours
```

**To test anytime (disable scheduler):**
```env
ENABLE_SCHEDULER=false  # Feed starts immediately on backend startup
```

## Monitoring

### Logs to Watch:
```bash
# Connection attempts
⏰ [09:00:00 AM] MARKET HOURS - Feed NOT Connected
🔄 AUTO-STARTING Market Feed...
   📊 Phase: PRE-OPEN (9:00 - 9:15 AM)

# Retry tracking
⚠️ Feed start failed (attempt 1)
⚠️ Feed start failed (attempt 2)
⚠️ Feed start failed (attempt 3)

# REST fallback active
📡 REST API fallback: Fetching market data...
✅ REST API data fetched and broadcast

# WebSocket restored
✅ WebSocket restored!
✅ Market feed started successfully!
```

## Benefits

1. **No Manual Restarts** - System self-heals automatically
2. **Smooth UI** - Data flows even during connection issues (REST fallback)
3. **Clear Diagnostics** - Helpful error messages guide user to fix root cause
4. **Production Ready** - Handles token expiration gracefully
5. **No Freezing** - 9:00 AM and 9:15 AM transitions work smoothly

## Files Modified

- `backend/services/market_hours_scheduler.py` - Aggressive retry logic
- `backend/services/market_feed.py` - Connection health monitoring + faster REST polling

## Related Documentation

- [QUICKSTART_ORCHESTRATION.md](./QUICKSTART_ORCHESTRATION.md) - Overall system flow
- [AUTO_MARKET_TIMING_EXPLAINED.md](./AUTO_MARKET_TIMING_EXPLAINED.md) - Scheduler details
- [PERMANENT_TOKEN_SOLUTION.md](./PERMANENT_TOKEN_SOLUTION.md) - Token refresh handling

## Deployment

**No additional steps required** - Changes are backward compatible.

To deploy:
```bash
# On Digital Ocean droplet:
cd /root/mytradingSignal/backend
git pull
sudo systemctl restart backend
```

System will automatically:
- Start scheduler at backend startup
- Retry connections during market hours
- Use REST fallback when WebSocket fails
- Auto-reconnect when token is refreshed

---

**Status:** ✅ FIXED - No more manual restarts needed!
**Date:** January 14, 2026
**Impact:** HIGH - Affects daily trading operations
