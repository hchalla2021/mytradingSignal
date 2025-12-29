# Live Data Not Updating - Troubleshooting Guide

## Issue: UI Not Showing Live Price Updates

### Quick Diagnosis Steps

#### 1. Check Backend WebSocket Connection
Open backend logs and look for:
```
✅ Connected to Zerodha KiteTicker
📊 Subscribed to: ['NIFTY', 'BANKNIFTY', 'SENSEX']
✅ Market feed is now LIVE - Waiting for ticks...
🟢 First tick received for NIFTY: Price=23500.50, Change=+0.25%
```

**If you DON'T see "First tick received":**
- Market is closed (9:15 AM - 3:30 PM IST on trading days)
- Zerodha access token is expired/invalid
- Internet connection issue
- Zerodha API is down

#### 2. Check Frontend WebSocket Connection
Open browser DevTools Console (F12) and look for:
```
✅ WebSocket connected
[WS SNAPSHOT] Received 3 symbols at 10:30:45 AM
[WS TICK] NIFTY: ₹23500.50 (+0.25%) at 10:30:46 AM
[WS TICK] NIFTY: ₹23501.00 (+0.26%) at 10:30:47 AM
```

**If you see "WebSocket connected" but NO TICKS:**
- Backend is not receiving data from Zerodha
- Check backend logs for errors

**If you DON'T see "WebSocket connected":**
- Frontend cannot reach backend WebSocket endpoint
- Check `NEXT_PUBLIC_WS_URL` in `.env.local`
- Backend might not be running
- CORS or network issue

#### 3. Check Price Updates in UI
Look for these console logs in browser:
```
[NIFTY] 🟢 Price UP: 23500.50 → 23501.00
[NIFTY] PCR Update: 1.05 | Call: 15000 | Put: 16000 | 10:30:46 AM
```

**If you see WebSocket ticks but NO price update logs:**
- React state not updating properly
- Component not re-rendering
- Data prop not changing reference

### Common Issues & Fixes

#### Issue 1: Zerodha Access Token Expired
**Symptoms:**
- Backend error: "TokenError" or "token expired"
- No ticks received from Zerodha

**Fix:**
1. Generate new access token: `python backend/get_token.py`
2. Update `.env` file with new token
3. Restart backend: `uvicorn main:app --reload`

#### Issue 2: Market is Closed
**Symptoms:**
- Backend shows: "Market may be closed"
- UI shows "OFFLINE" or cached data

**Fix:**
- Wait for market hours (9:15 AM - 3:30 PM IST, Mon-Fri)
- Backend will show last traded data when market is closed
- Data will auto-update when market opens

#### Issue 3: WebSocket Disconnected
**Symptoms:**
- UI shows "Connecting..." or "Disconnected"
- No ticks in browser console

**Fix:**
1. Check backend is running: `http://localhost:8000/health`
2. Check WebSocket URL in `.env.local`:
   ```
   NEXT_PUBLIC_WS_URL=ws://localhost:8000/ws/market
   ```
3. Restart frontend: `npm run dev`

#### Issue 4: React Not Re-rendering
**Symptoms:**
- WebSocket receives ticks (browser console shows them)
- But UI price doesn't update
- No flash animation on price change

**Fix:**
✅ **APPLIED IN RECENT UPDATE:**
- Added debug logging in `useMarketSocket.ts`
- Added `lastUpdate` timestamp in `IndexCard.tsx`
- Added price change logging with 🟢/🔴 indicators
- Added dependency on `data?.timestamp` to force re-renders

**Verify fix:**
1. Open browser console (F12)
2. Watch for: `[WS TICK]` and `[NIFTY] 🟢 Price UP:` logs
3. Price should update and flash green/red

#### Issue 5: localStorage Caching Old Data
**Symptoms:**
- UI shows old prices even after refresh
- Timestamp is outdated

**Fix:**
1. Clear browser localStorage:
   ```javascript
   // In browser console (F12)
   localStorage.removeItem('lastMarketData');
   ```
2. Hard refresh: `Ctrl + Shift + R` (Windows) or `Cmd + Shift + R` (Mac)

### Debugging Commands

#### Backend Health Check
```bash
# Check if backend is running
curl http://localhost:8000/health

# Check raw cache data
curl http://localhost:8000/ws/cache/NIFTY
```

#### Frontend WebSocket Test
```javascript
// In browser console (F12)
const ws = new WebSocket('ws://localhost:8000/ws/market');
ws.onopen = () => console.log('✅ Connected');
ws.onmessage = (e) => console.log('📨', JSON.parse(e.data));
ws.onerror = (e) => console.error('❌', e);
```

### Expected Data Flow

```
Zerodha WebSocket (KiteTicker)
    ↓
Backend: market_feed.py (_on_ticks)
    ↓
Backend: market_feed.py (_normalize_tick)
    ↓
Backend: market_feed.py (_update_and_broadcast)
    ↓
Backend: websocket_manager.py (broadcast)
    ↓
Frontend: useMarketSocket.ts (ws.onmessage)
    ↓
Frontend: setMarketData state update
    ↓
Frontend: IndexCard.tsx re-render
    ↓
UI: Price updates with flash animation
```

### Logs to Watch

#### Backend Logs (Terminal)
```
[BROADCAST] NIFTY: ₹23501.00 (+0.26%) → 2 clients
[PCR UPDATE] NIFTY: PCR=1.05, CallOI=15,000, PutOI=16,000
✅ Analysis added for NIFTY: ['signal', 'vwap', 'ema', 'rsi']
```

#### Frontend Logs (Browser Console)
```
[WS TICK] NIFTY: ₹23501.00 (+0.26%) at 10:30:46 AM
[NIFTY] 🟢 Price UP: 23500.50 → 23501.00
[NIFTY] PCR Update: 1.05 | Call: 15,000 | Put: 16,000 | 10:30:46 AM
```

### Still Not Working?

1. **Restart everything:**
   ```bash
   # Backend
   Ctrl+C
   uvicorn main:app --reload --host 0.0.0.0 --port 8000
   
   # Frontend (new terminal)
   Ctrl+C
   npm run dev
   ```

2. **Check all environment variables:**
   - Backend `.env`: `ZERODHA_API_KEY`, `ZERODHA_ACCESS_TOKEN`
   - Frontend `.env.local`: `NEXT_PUBLIC_WS_URL`

3. **Verify Zerodha credentials:**
   ```bash
   cd backend
   python get_token.py
   ```

4. **Check network connectivity:**
   - Can backend reach Zerodha? (check backend logs)
   - Can frontend reach backend? (check browser network tab)

5. **Look for JavaScript errors:**
   - Open browser DevTools (F12) → Console tab
   - Any red errors?

### Recent Fixes Applied

✅ **Enhanced Logging (Just Applied):**
- `useMarketSocket.ts`: Added `[WS TICK]` and `[WS SNAPSHOT]` logs
- `IndexCard.tsx`: Added `lastUpdate` timestamp and price change logs
- `market_feed.py`: Added `[BROADCAST]` log with client count
- `websocket_manager.py`: Added warning for no clients

✅ **Force Re-render on Data Change:**
- Added `data?.timestamp` dependency in `useEffect`
- Added visual "last update" timestamp in status badge
- Price change detection now more reliable

### Contact Support

If issue persists after trying all above:
1. Share backend logs (last 50 lines)
2. Share browser console logs (F12)
3. Share `.env` file (remove sensitive values)
4. Mention if market is currently open/closed
