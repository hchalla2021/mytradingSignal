# 🔍 Analysis Section Troubleshooting Guide

## Current Issue
Technical Analysis cards showing "Loading Analysis..." or fallback data with ₹0 values.

## Root Cause
**Zerodha Access Token has EXPIRED** (tokens expire daily at midnight IST)

## Quick Check

1. **Open Browser Console (F12)**
   - Go to http://localhost:3000
   - Press F12 → Console tab
   - Look for these logs:
     ```
     🔄 Fetching analysis from: http://127.0.0.1:8000/api/analysis/analyze/all
     📡 Response status: 200 OK
     ✅ Analysis data received: {NIFTY: {...}, BANKNIFTY: {...}, SENSEX: {...}}
     📊 Symbols in response: ['NIFTY', 'BANKNIFTY', 'SENSEX']
     ```

2. **Check Analysis Health API**
   - Open: http://127.0.0.1:8000/api/analysis/health
   - Look for: `"zerodha_api": "connected"` or `"disconnected"`

3. **Check Analysis Data API**
   - Open: http://127.0.0.1:8000/api/analysis/analyze/all
   - Should return JSON with NIFTY, BANKNIFTY, SENSEX

## Fix: Re-authenticate with Zerodha

### Option 1: Quick Re-auth (Recommended)
```bash
# Open this URL in your browser:
http://127.0.0.1:8000/api/auth/login-url

# It will redirect you to Zerodha login
# After login, you'll be redirected back and token will auto-save
```

### Option 2: Manual Token Update
1. Go to https://kite.zerodha.com
2. Login with your credentials
3. Get new access token
4. Update `backend/.env`:
   ```
   ZERODHA_ACCESS_TOKEN=your_new_token_here
   ```
5. Restart backend server

## What Should Work Now

After re-authentication:
- ✅ All price values should show real numbers (not ₹0)
- ✅ Analysis cards show LIVE data
- ✅ "Analysis Live" indicator turns green
- ✅ Support/Resistance show actual levels
- ✅ Volume data displays
- ✅ RSI, EMA values populated

## Demo Data vs Live Data

### If Token Expired (Demo Mode):
- Shows realistic price levels (NIFTY ~23900, BANKNIFTY ~51500)
- All indicators present but marked as demo
- Warning banner: "TOKEN EXPIRED" in amber
- Data updates every 3 seconds (but same values)

### When Token Valid (Live Mode):
- Real-time price updates from NSE/BSE
- Actual volume, OI data
- Calculated VWAP, EMA from real ticks
- Data changes with market movements

## Technical Details

### Data Flow
```
Zerodha REST API → Backend Analysis Service → Frontend useAnalysis Hook → AnalysisCard Components
```

### Polling Mechanism
- Frontend polls every 3 seconds
- Backend fetches live quotes via KiteConnect
- Fallback to demo data if token invalid

### Key Files
- Backend: `backend/services/zerodha_direct_analysis.py`
- Frontend Hook: `frontend/hooks/useAnalysis.ts`
- UI Component: `frontend/components/AnalysisCard.tsx`
- API Router: `backend/routers/analysis.py`

## Expected Console Output (When Working)

```
📊 Starting analysis polling (every 3s)
🔄 Fetching analysis from: http://127.0.0.1:8000/api/analysis/analyze/all
📡 Response status: 200 OK
✅ Analysis data received: {
  NIFTY: {
    symbol: "NIFTY",
    signal: "BUY_SIGNAL",
    confidence: 0.65,
    indicators: {
      price: 23956.40,
      high: 24012.10,
      low: 23891.55,
      ...
    }
  },
  BANKNIFTY: {...},
  SENSEX: {...}
}
📊 Symbols in response: ['NIFTY', 'BANKNIFTY', 'SENSEX']
📊 Analysis State: {
  analyses: {...},
  isAnalysisConnected: true,
  hasData: true,
  symbolKeys: ['NIFTY', 'BANKNIFTY', 'SENSEX']
}
```

## Still Not Working?

1. **Check Backend Terminal**
   - Should see: "✅ Direct Zerodha analysis completed for 3 symbols"
   - If seeing: "❌ Direct quote error" → Token issue

2. **Check Frontend Terminal**
   - Should see: "✓ Compiled /page"
   - No errors during compilation

3. **Network Tab (F12 → Network)**
   - Filter: "analyze"
   - Should see requests every 3 seconds
   - Status should be 200
   - Preview should show JSON data

4. **React DevTools**
   - Install React DevTools extension
   - Check AnalysisCard props
   - `analysis` prop should be object, not null

## Emergency Fallback

If token can't be refreshed right now:
- Demo data will still display (shows UI is working)
- All indicators visible with realistic values
- Signal logic still operates (based on demo data)
- Re-authenticate when market opens

---

**Last Updated:** December 26, 2025
**Status:** Token requires daily refresh
**Market Hours:** 9:15 AM - 3:30 PM IST
