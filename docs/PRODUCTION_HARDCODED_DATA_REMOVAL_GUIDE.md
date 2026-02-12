# 🔧 PRODUCTION DEPLOYMENT - HARDCODED DATA REMOVAL GUIDE

**Created:** February 12, 2026
**Purpose:** Remove all hardcoded/sample data before production deployment

---

## ISSUE 1: Volume Pulse Endpoint (Line 213-237)

### Current Problematic Code:
```python
if df.empty or len(df) < 10:
    # No cached data - return sample data to show UI
    print(f"[VOLUME-PULSE] 🎭 Using SAMPLE data (no backup available)")
    return {
        "symbol": symbol,
        "volume_data": {
            "green_candle_volume": 450000 if symbol == "NIFTY" else 380000,
            "red_candle_volume": 320000 if symbol == "NIFTY" else 410000,
            "green_percentage": 58.4 if symbol == "NIFTY" else 48.1,
            "red_percentage": 41.6 if symbol == "NIFTY" else 51.9,
            "ratio": 1.41 if symbol == "NIFTY" else 0.93
        },
        "pulse_score": 65 if symbol == "NIFTY" else 45,
        "signal": "BUY" if symbol == "NIFTY" else "SELL",
        "confidence": 58 if symbol == "NIFTY" else 52,
        "trend": "BULLISH" if symbol == "NIFTY" else "BEARISH",
        "status": "CACHED",
        "data_status": "CACHED",
        "timestamp": datetime.now().isoformat(),
        "message": "📊 Last Market Session Data (Market Closed)",
        "candles_analyzed": 100,
        "token_valid": token_status["valid"]
    }
```

### Replacement Code:
```python
if df.empty or len(df) < 10:
    # No cached data - return error instead of sample data
    from services.market_feed import is_market_open
    status = "MARKET_CLOSED" if not is_market_open() else "NO_DATA"
    message = "🔴 Market is currently closed. Data will update when market opens (9:15 AM IST)" if not is_market_open() else "🔴 Waiting for live market data. Please ensure Zerodha connection is active."
    
    return {
        "symbol": symbol,
        "volume_data": None,
        "pulse_score": None,
        "signal": "NEUTRAL",
        "confidence": 0,
        "trend": None,
        "status": status,
        "data_status": status,
        "timestamp": datetime.now().isoformat(),
        "message": message,
        "candles_analyzed": 0,
        "token_valid": token_status["valid"],
        "error": "NO_MARKET_DATA",
        "notes": "Production system: No sample data used. Waiting for live market data."
    }
```

**Why:**
- Removes hardcoded volumes (450000, 380000, 320000, 410000)
- Removes hardcoded signals ("BUY", "SELL")
- Returns proper error state instead of fake data
- Respects market session (closed vs open)

---

## ISSUE 2: Candle Intent Endpoint (Line 1506-1541)

### Current Problematic Code:
```python
# Return sample data to demonstrate UI
print(f"   → Returning SAMPLE data to demonstrate UI")
base_price = 24500 if symbol == "NIFTY" else 51000 if symbol == "BANKNIFTY" else 80000
is_bullish = symbol != "BANKNIFTY"

return {
    "symbol": symbol,
    "timestamp": datetime.now().isoformat(),
    "current_candle": {
        "open": base_price - 30, "high": base_price + 50, "low": base_price - 40, "close": base_price + 20,
        "volume": 450000, "range": 90, "body_size": 50,  # ❌ HARDCODED
        "upper_wick": 30, "lower_wick": 10
    },
    "pattern": {
        "type": "BULLISH_HAMMER" if is_bullish else "BEARISH_SHOOTING_STAR",
        "strength": 75 if is_bullish else 68,
        "intent": "BULLISH" if is_bullish else "BEARISH",
        "interpretation": "Strong buying pressure with minimal selling" if is_bullish else "Rejection at highs - bears taking control",
        "confidence": 72 if is_bullish else 65
    },
    "professional_signal": "BUY" if is_bullish else "SELL",
    "volume_analysis": {
        "volume": 450000,  # ❌ HARDCODED
        "avg_volume": 320000,  # ❌ HARDCODED
        "volume_ratio": 1.41,
        "volume_type": "HIGH",
        "efficiency": "STRONG"
    },
    "trap_status": {
        "is_trap": False,
        "trap_type": None,
        "severity": 0
    },
    "status": "CACHED",
    "data_status": "CACHED",
    "message": "📊 Last Market Session Data (Market Closed)" if token_status["valid"] else "🔑 Sample data - Login to see real market data",
    "candles_analyzed": 100,
    "token_valid": token_status["valid"]
}
```

### Replacement Code:
```python
# Return error instead of sample data
from services.market_feed import is_market_open
status = "MARKET_CLOSED" if not is_market_open() else "NO_DATA"
message = "🔴 Market is currently closed. Data will update when market opens (9:15 AM IST)" if not is_market_open() else "🔴 Waiting for live market data. Please ensure Zerodha connection is active."

return {
    "symbol": symbol,
    "timestamp": datetime.now().isoformat(),
    "current_candle": None,
    "pattern": None,
    "professional_signal": "NEUTRAL",
    "volume_analysis": None,
    "trap_status": None,
    "status": status,
    "data_status": status,
    "message": message,
    "candles_analyzed": 0,
    "token_valid": token_status["valid"],
    "error": "NO_MARKET_DATA",
    "notes": "Production system: No sample data used. Waiting for live market data."
}
```

**Why:**
- Removes hardcoded candle data (base_price, range=90, body_size=50, volume=450000)
- Removes hardcoded patterns (BULLISH_HAMMER, BEARISH_SHOOTING_STAR)
- Removes hardcoded signals (BUY, SELL based on symbol)
- Returns null data with proper error message

---

## ISSUE 3: Zone Control Endpoint (Line 411-440)

**Location:** `backend/routers/advanced_analysis.py` around line 411

**Same Pattern:** Check for similar hardcoded returns and replace with error responses

---

## ISSUE 4: Remove Debug Print Statements

### File: `backend/routers/advanced_analysis.py`

**Search for and remove:**
```
print(f"[VOLUME-PULSE] 🎭 Using SAMPLE data...")
print(f"[VOLUME-PULSE] 🕯️  INSTANT CANDLE...)
print(f"\n[VOLUME-PULSE] 📈 INSTANT ANALYSIS...")
print(f"   → Returning SAMPLE data to demonstrate UI")
```

**Action:** Delete or wrap in `if DEBUG:` condition

---

## ISSUE 5: Remove/Disable Debug Logging in Hooks

### File: `frontend/hooks/useOverallMarketOutlook.ts`

**Current:** ~50 console.log statements

**Fix Option A - Conditional Logging:**
```typescript
const DEBUG = process.env.NODE_ENV === 'development';

if (DEBUG) {
    console.log('[OUTLOOK] Signal updated:', oldSignal, '→', newSignal);
}
```

**Fix Option B - Remove All:**
Delete all console.log lines (recommended for production)

---

## ISSUE 6: Delete Test Files

**Run this command to remove all test files:**
```bash
cd backend

# Remove test files
rm -f test_*.py
rm -f test_*.js
rm -f test_output.txt
rm -f test_results.txt

# Remove data factory
rm -f data/test_data_factory.py

# Remove generation scripts
rm -f scripts/generate_test_data.py
rm -f scripts/validate_pcr_setup.py

# Remove examples
rm -f examples/ema_trading_examples.py
rm -f config/ema_test.py
```

**Windows PowerShell:**
```powershell
cd backend

# Remove test files
Get-ChildItem -Path '.' -Filter 'test_*.py' -Recurse | Remove-Item -Force
Get-ChildItem -Path '.' -Filter 'test_*.js' -Recurse | Remove-Item -Force
Remove-Item -Path 'test_output.txt', 'test_results.txt' -Force -ErrorAction SilentlyContinue

# Remove data factory
Remove-Item -Path 'data/test_data_factory.py' -Force
Remove-Item -Path 'scripts/generate_test_data.py' -Force
Remove-Item -Path 'scripts/validate_pcr_setup.py' -Force
Remove-Item -Path 'examples/ema_trading_examples.py' -Force
Remove-Item -Path 'config/ema_test.py' -Force
```

---

## ISSUE 7: Disable Mock Market Feed

### File: `backend/main.py` (around line 112)

**Current Logic (GOOD):**
```python
if auth_state_manager.is_authenticated:
    market_feed_service = MarketFeedService()
else:
    market_feed_service = MockMarketFeedService()
```

**This is OK** - Only uses mock when authentication fails. No change needed.

---

## ISSUE 8: Set Production Environment Variables

### File: `.env` (Production)

**MUST SET:**
```bash
# Zerodha Credentials (REQUIRED FOR PRODUCTION)
ZERODHA_API_KEY=your_actual_api_key_here
ZERODHA_API_SECRET=your_actual_api_secret_here
ZERODHA_ACCESS_TOKEN=will_be_set_after_login

# Security
JWT_SECRET=generate_a_random_string_here_keep_it_secret

# Redis (if available)
REDIS_URL=redis://your-server:6379

# Market Config
DEBUG=False
ENABLE_SCHEDULER=true
MARKET_OPEN=09:15:00
MARKET_CLOSE=15:30:00

# Data Flags (DISABLE IN PRODUCTION)
TEST_DATA_ENABLED=False
MOCK_DATA_ENABLED=False
SAMPLE_DATA_ENABLED=False
```

---

## SUMMARY TABLE

| Issue | File | Lines | Status | Fix |
|-------|------|-------|--------|-----|
| **Hardcoded volumes** | advanced_analysis.py | 213-237 | ❌ | Return error instead |
| **Hardcoded candle data** | advanced_analysis.py | 1506-1541 | ❌ | Return error instead |
| **Hardcoded zone data** | advanced_analysis.py | 411-440 | ❌ | Return error instead |
| **Debug prints** | advanced_analysis.py | Various | ⚠️ | Remove or gate |
| **Test files** | backend/test_*.py | All | ❌ | Delete |
| **Test factory** | data/test_data_factory.py | All | ❌ | Delete |
| **Console.logs** | useOverallMarketOutlook.ts | ~50 | ⚠️ | Remove |
| **Mock fallback** | main.py | 112 | ✅ | Keep (auth-gated) |
| **Environment vars** | .env | All | ⚠️ | Set production values |

---

## TESTING AFTER FIXES

### 1. Start Backend with Production Config
```bash
cd backend
export DEBUG=False
export ZERODHA_API_KEY=<real-key>
export ZERODHA_API_SECRET=<real-secret>
uvicorn main:app --reload --port 8000
```

### 2. Check for "SAMPLE data" Messages
```bash
# Should NOT see any of these in logs:
# - "Using SAMPLE data"
# - "Returning SAMPLE data"
# - "Last Market Session Data"
```

### 3. Test Endpoints with Live Data
```bash
# When market is OPEN (9:15 AM - 3:30 PM):
curl http://localhost:8000/api/advanced/volume-pulse/NIFTY
# Should return real volume data, not hardcoded values

# Check response:
# - volume_data should have real values
# - status should be "LIVE"
# - message should mention Zerodha live data
```

### 4. Test Market Closed Response
```bash
# When market is CLOSED (after 3:30 PM):
curl http://localhost:8000/api/advanced/volume-pulse/NIFTY
# Should return:
# - status: "MARKET_CLOSED"
# - message: "🔴 Market is currently closed..."
# - volume_data: null
# - NOT hardcoded sample values
```

### 5. Frontend Display Verification
- Open http://localhost:3000
- Check Overall Market Outlook shows:
  ✅ Real confidence scores (not hardcoded)
  ✅ Real signal calculations (not hardcoded)
  ✅ No "SAMPLE data" indicators
  ✅ Live price updates from WebSocket

---

## DEPLOYMENT COMMANDS

### Production Build
```bash
# Backend
cd backend
pip install -r requirements.txt
export ZERODHA_API_KEY=<actual>
export ZERODHA_API_SECRET=<actual>
export JWT_SECRET=<random>
export DEBUG=False

# Run with production ASGI server
gunicorn main:app --workers 4 \
  --worker-class uvicorn.workers.UvicornWorker \
  --bind 0.0.0.0:8000 \
  --timeout 120

# Frontend
cd frontend
npm install
npm run build
npm start
```

### Deployment Verification
```bash
# Check for any "SAMPLE" or "mock" in logs
grep -r "SAMPLE\|mock\|test" /var/log/trading-app

# Should return nothing (or only in expected locations)
```

---

## POST-DEPLOYMENT CHECKLIST

- [ ] Remove all test files (test_*.py)
- [ ] Verify no "SAMPLE data" in production logs
- [ ] Verify live prices match Zerodha terminal
- [ ] Monitor for errors (no auth/data issues)
- [ ] Check WebSocket connection (real ticks)
- [ ] Verify all 9 signals calculating
- [ ] Test with live market overnight
- [ ] Monitor server logs for issues

---

## ROLLBACK PLAN

If production issues occur:
1. **Check logs:** Look for auth/connection errors
2. **Verify Zerodha:** Confirm API key and token validity
3. **Check network:** Ensure server can reach Zerodha
4. **Restart service:** Kill FastAPI, restart with debug flag
5. **Switch to previous:** Deploy backup version if critical

---
