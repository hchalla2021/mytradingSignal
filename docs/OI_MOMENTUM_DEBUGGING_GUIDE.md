# OI Momentum Signals - Debugging & Monitoring Guide

## Quick Status Check

### Option 1: Watch Real-Time Data Flow (Live Monitor)
```bash
python backend/watch_oi_momentum.py
```
Shows live updates every 5 seconds as candles accumulate and signals generate:
- Candle accumulation progress bar
- Current price & trend
- Signal status (WAITING → BUY/SELL with confidence)

**Use during market hours to see data arriving in real-time**

### Option 2: One-Time Status Report
```bash
python backend/check_oi_momentum_status.py
```
Shows complete snapshot:
- Authentication status
- Last market values (NIFTY, BANKNIFTY, SENSEX)
- Candle availability
- OI Momentum signal values
- Any errors

### Option 3: API Endpoint (For Integration)
```bash
curl http://localhost:8000/api/diagnostics/oi-momentum-debug
```
Returns JSON with full diagnostic data:
```json
{
  "timestamp": "2024-02-18T14:30:00+05:30",
  "market_data": {
    "NIFTY": {
      "price": 19200.50,
      "change": +150.25,
      "changePercent": +0.79,
      "status": "LIVE",
      "timestamp": "2024-02-18T14:29:55+05:30"
    }
  },
  "candle_data": {
    "NIFTY": {
      "candle_count": 45,
      "sufficient": true,
      "message": "✅ 45 candles available"
    }
  },
  "oi_momentum_signals": {
    "NIFTY": {
      "signal_5m": "BUY",
      "signal_15m": "BUY",
      "final_signal": "BUY",
      "confidence": 78,
      "ready": true
    }
  },
  "summary": {
    "overall_status": "✅ ALL SYSTEMS GO"
  }
}
```

---

## Understanding OI Momentum Signals

### The Formula
```
5m Entry Timing (EXECUTION)
+
15m Trend Direction (CONFIRMATION)
+
20+ Candle History (DATA)
=
Final Signal (BUY/SELL/NEUTRAL)
```

### Signal Types

| Signal | Meaning | When to Use |
|--------|---------|------------|
| **STRONG_BUY** 🚀 | Confidence 75%+ | Aggressive entry |
| **BUY** 📈 | Confidence 50-74% | Conservative entry |
| **NEUTRAL** ⏸️ | Confidence <50% | Wait & watch |
| **SELL** 📉 | Confidence 50-74% | Exit/Short |
| **STRONG_SELL** 🔻 | Confidence 75%+ | Aggressive exit |

### Why "NO_SIGNAL"?
Usually means one of these:
1. ❌ **Insufficient Candles**: Need 20+ (takes ~10 minutes from market open)
2. ❌ **WebSocket Not Connected**: Check authentication
3. ❌ **Market Closed**: Only works 9:15 AM - 3:30 PM IST
4. ❌ **No Market Data**: Zerodha feed not active

---

## Common Issues & Solutions

### Issue 1: "Waiting for live market data - accumulating candles"

**Cause**: System needs 20+ candles to analyze. At market open (9:15 AM), you have 0 candles.

**Timeline**:
- 9:15 AM: Market opens, 0 candles
- 9:25 AM: 2 candles (10 minutes)
- 9:35 AM: 4 candles (20 minutes)
- 9:45 AM: 6 candles (30 minutes)
- **10:05 AM**: 12 candles (50 minutes) = Signals may appear

**But with backup restore**:
- 8:55 AM: Previous day's 20+ candles restored → 🚀 Signals READY at 9:15 AM!

**Solution**: 
- System auto-loads previous day's candles at startup
- Or wait 10-20 minutes for live candles to accumulate

### Issue 2: No data showing at all

**Check these in order**:

```
Step 1: Authentication
├─ Run: python check_oi_momentum_status.py
├─ Look for: "Authenticated: ✅ YES"
└─ If NO: Click LOGIN button in UI

Step 2: WebSocket Connection
├─ Run: python watch_oi_momentum.py
├─ Look for: Candle count increasing
└─ If not: Zerodha token may be expired

Step 3: Market Hours
├─ Time must be: 9:15 AM - 3:30 PM IST
├─ Day must be: Monday - Friday (not holidays)
└─ If outside: Wait for market to open

Step 4: Candle Accumulation
├─ Run: watch_oi_momentum.py
├─ Look for: Candle count reaching 20
└─ Wait 10+ minutes if below 20
```

### Issue 3: Signals show NEUTRAL even at high volume times

**Reason**: All 4 buy/sell conditions not met simultaneously:
1. Liquidity grab (volume spike)
2. OI change (>3%) 
3. Volume confirmation (1.5x average)
4. Price structure (higher highs/lower lows)

**Solution**: Need 2-3 conditions for stronger signal, not just one.

### Issue 4: WebSocket Keeps Disconnecting

**Check**:
1. Is Zerodha token valid? (expires every 24 hours)
2. Is internet stable?
3. Is Zerodha API up? (check status.zerodha.com)

**Fix**:
```bash
# Refresh token
python quick_token_fix.py

# Or logout/login in UI
```

---

## Data Flow Diagram

```
Market Open (9:15 AM)
    ↓
Zerodha WebSocket Feed
    ↓
Tick Data (price, volume, OI)
    ↓
Candle Aggregation (into 5-min candles)
    ↓
Cache Storage (Redis)
    ↓
OI Momentum Service
├─ 5m timeframe analysis (ENTRY TIMING)
├─ 15m timeframe analysis (TREND DIRECTION)
├─ Combine both + confidence calculation
└─ Return FINAL SIGNAL
    ↓
Frontend Dashboard (OIMomentumCard)
    ├─ Shows signal: STRONG_BUY / BUY / NEUTRAL / SELL / STRONG_SELL
    ├─ Shows confidence: 0-100%
    ├─ Shows reasons (top 3-5)
    └─ Shows metrics breakdown
```

---

## Real Example Walkthrough

### Scenario: 9:30 AM - Market just opened

**Status Check Output**:
```
2️⃣  LAST MARKET VALUES
   NIFTY
   Price: ₹19,200.50
   Change: 📈 +150.50 (+0.79%)
   Status: LIVE

3️⃣  CANDLE DATA AVAILABILITY
   NIFTY: ⚠️ LOADING (12/20 candles, need 8 more)
   Last: 2024-02-18T09:30:00+05:30 @ ₹19,200.50

4️⃣  OI MOMENTUM SIGNALS
   NIFTY
   ⚠️ NO_SIGNAL - Insufficient candles (12/20)
```

**What's happening**:
- ✅ Price data arriving
- ⚠️ Candles not yet sufficient (12/20)
- ⏳ Signals waiting for 20+ candles

**Next step**: Wait 5 minutes for more candles to arrive

### Status Check At 9:50 AM - Signals Activated

```
4️⃣  OI MOMENTUM SIGNALS
   NIFTY
   Signal: 🚀 STRONG_BUY
   5m Entry: BUY
   15m Trend: STRONG_BUY
   Confidence: 82%
   Price: ₹19,250.00
   Top Reason: 💎 Liquidity Grab Detected
```

**What's happening**:
- ✅ Market data flowing
- ✅ 30+ candles accumulated
- ✅ Signal generated with 82% confidence
- 📈 Ready to trade!

---

## Monitoring Best Practices

### During Market Hours (9:15 AM - 3:30 PM)

1. **At Open (9:15 AM)**
   ```bash
   python check_oi_momentum_status.py
   ```
   Expect: Candles loading, NO_SIGNAL, market data arriving

2. **After 10 Min (9:25 AM)**
   ```bash
   python watch_oi_momentum.py
   ```
   Watch: Candle count reaching 20, signals starting

3. **Continuous Monitoring**
   ```bash
   # Keep this running in separate terminal
   watch -n 5 'curl -s http://localhost:8000/api/diagnostics/oi-momentum-debug | jq .oi_momentum_signals'
   ```

### Performance Indicators

✅ **Healthy System**:
- Candle count increasing by 1 every 5 minutes
- Market data timestamp updating every 1-2 seconds
- Signal changing as market moves
- No errors in logs

⚠️ **Degraded**:
- Candle count stuck (feed disconnected)
- Old timestamps (old data)
- All symbols showing NEUTRAL (no clear trend)

❌ **Failed**:
- No market data
- No candles
- Zerodha connection error
- Token expired

---

## API Response Codes

### /api/diagnostics/oi-momentum-debug:

**200 OK** with `summary.overall_status`

| Status | Meaning | Action |
|--------|---------|--------|
| ✅ ALL SYSTEMS GO | Everything working | Start trading |
| ⚠️ PARTIAL DATA | Some symbols have data | Wait for others |
| ❌ NO DATA | No data flowing | Check logs |

---

## Troubleshooting Checklist

- [ ] Market is open (9:15 AM - 3:30 PM IST, weekdays only)
- [ ] Zerodha token is fresh (logged in within 24 hours)
- [ ] Internet connection is stable
- [ ] Backend service is running (`uvicorn main:app --reload`)
- [ ] Frontend showing "Connected" status
- [ ] At least one symbol has market data
- [ ] At least one symbol has 20+ candles
- [ ] Candle timestamp is recent (within last 5 minutes)

If all checked ✓ but still no signals:
```bash
# Check logs
tail -f /var/log/oi-momentum.log

# Or run watch in verbose mode
PYTHONUNBUFFERED=1 python watch_oi_momentum.py 2>&1 | tee debug.log
```

---

## Quick Reference

### File Structure
```
backend/
├── check_oi_momentum_status.py     ← One-time status check
├── watch_oi_momentum.py             ← Live monitoring
├── routers/
│   └── diagnostics.py               ← API endpoint
└── services/
    └── oi_momentum_service.py       ← Signal engine
```

### Useful Endpoints
```
GET /api/diagnostics/oi-momentum-debug          ← Full diagnostic JSON
GET /api/oi-momentum/all                        ← All signals only
GET /api/oi-momentum/NIFTY                      ← Single symbol
GET /health                                      ← System health
```

### Log Locations
```
Backend logs: stdout (when running uvicorn)
OI Momentum debug: check_oi_momentum_status.py output
Live monitoring: watch_oi_momentum.py output
```

---

## When to Use Each Tool

| Tool | When | Why |
|------|------|-----|
| `check_oi_momentum_status.py` | Once at startup | Get snapshot of current state |
| `watch_oi_momentum.py` | During market hours | Watch data flowing in real-time |
| API endpoint | Integration/dashboards | Programmatic access to data |
| Logs | Debugging issues | Understand what went wrong |

---

## Summary

OI Momentum Signals work through this process:
1. **9:15 AM**: Market opens, WebSocket connects
2. **First 10 min**: Candles accumulate (or restored automatically)
3. **After 20 candles**: Analysis generates signals
4. **5m + 15m combo**: Provides final signal + confidence

Monitor it with:
- `watch_oi_momentum.py` for live flow
- `check_oi_momentum_status.py` for snapshots
- API endpoint for integration

The system is **self-healing**:
- Auto-restores prev day candles at startup
- Auto-fallback to REST API if WebSocket fails
- Auto-reconnect when token refreshed

Just keep an eye on candle count—once you hit 20+, signals activate! 🚀
