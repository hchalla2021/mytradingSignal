# 🔍 Order Flow Loading Issue - Diagnostic Guide

## Problem
Frontend shows "Loading order flow..." but data never appears for NIFTY, BANKNIFTY, SENSEX.

This means: **WebSocket is not connecting properly**

---

## Quick Diagnosis Checklist

### 1️⃣ **Is Backend Running?**

**Open Terminal and run:**
```powershell
# Check if backend process exists
Get-Process | Select-Object -Property ProcessName | Where-Object {$_.ProcessName -like "*python*"}

# Or check if port 8000 is listening
netstat -ano | findstr :8000
```

**Expected Output:**
- Should see `python.exe` running
- Should see port 8000 in LISTENING state

**If NOT running:**
```bash
cd backend
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

---

### 2️⃣ **Can Frontend Reach Backend?**

**Open Browser Console (F12) and run:**
```javascript
// Test 1: Can browser reach backend?
fetch('http://localhost:8000/health')
  .then(r => r.text())
  .then(console.log)
  .catch(e => console.error('❌ BACKEND NOT REACHABLE:', e));

// Test 2: Check WebSocket URL  
console.log('WS URL:', process.env.NEXT_PUBLIC_WS_URL);
```

**Expected:**
- Fetch should return some response (status 200 or similar)
- WS URL should be `ws://localhost:8000/ws/market`

**If fetch fails:**
- Backend is not running (go back to Step 1)
- Port 8000 is blocked by firewall
- Backend is running on different host/port

---

### 3️⃣ **WebSocket Connection Status**

**Browser Console:**
```javascript
// Monitor WebSocket attempts
const originalWS = WebSocket;
window.WebSocket = function(...args) {
  console.log('🔌 WebSocket attempting to connect:', args[0]);
  const ws = new originalWS(...args);
  
  ws.onopen = () => console.log('✅ WS CONNECTED');
  ws.onerror = (e) => console.error('❌ WS ERROR:', e);
  ws.onclose = () => console.log('🔌 WS CLOSED');
  
  return ws;
};

// Now reload page
window.location.reload();
```

**Watch for:**
```
🔌 WebSocket attempting to connect: ws://localhost:8000/ws/market
✅ WS CONNECTED
```

**If you see ERROR instead:**
Note the exact error message and go to Step 4.

---

### 4️⃣ **Backend WebSocket Endpoint Status**

**PowerShell:**
```powershell
# Test WebSocket endpoint is online
$response = Invoke-WebRequest -Uri "http://localhost:8000/ws/market" -TimeoutSec 5 2>&1
Write-Host $response.StatusCode
```

**Expected:** Might show error (WebSocket isn't HTTP) but shows connection was possible.

**Better test - Check Backend Logs:**
```bash
# In backend terminal, look for:
# 🔥 Starting Production Market Feed Service...
# ✅ Market feed started
# 🔌 Client connected
```

---

## Common Issues & Solutions

### Issue 1: "BACKEND NOT REACHABLE"
```
Solution:
1. Start backend: cd backend && python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
2. Wait 5 seconds for it to start
3. Check for errors in backend terminal
4. Reload frontend page (F5)
```

### Issue 2: WS Connection Timeout (10+ seconds)
```
Solution:
1. Check backend logs for errors
2. Verify port 8000 is not blocked
3. Try accessing http://localhost:8000 in browser
4. Check for firewall rules blocking port 8000
```

### Issue 3: WS Connection Closes Immediately
```
Solution:
1. Error in WebSocket handler (check backend logs)
2. Zerodha authentication failed - check ~/.kite.config
3. Market data not flowing - check test_market_status_direct.py
```

### Issue 4: Connection Works But No Data
```
Solution:
1. Backend is connected but not sending ticks
2. Order flow analyzer not initialized: check backend startup logs
3. Run: python test_order_flow.py (to verify analyzer works)
4. Check if Zerodha token is valid (market hours + trading session)
```

---

## Step-by-Step Debug Procedure

### STEP A: Verify Backend is Starting Correctly

**Terminal - Run this:**
```bash
cd backend
python -c "from services.order_flow_analyzer import order_flow_analyzer; print('✅ Order Flow Analyzer loaded successfully')"
```

**Expected Output:**
```
✅ Order Flow Analyzer loaded successfully
```

**If Error:**
```
ModuleNotFoundError: No module named 'services'
Solution: Install dependencies: pip install -r requirements.txt
```

---

### STEP B: Start Backend with Debug Output

**Terminal:**
```bash
cd backend
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

**Watch for these logs:**
```
✅ Uvicorn running on http://0.0.0.0:8000
🚀 ProductionMarketFeedService initialized
🔥 Starting Production Market Feed Service...
✅ Market Feed Status: ONLINE
🔌 Client connected  <-- Frontend connected
📊 Order flow received for NIFTY: STRONG_BUY  <-- Data flowing!
```

**If you see:**
```
❌ Error in WebSocket handler
```
Note the error and check backend/routers/market.py

---

### STEP C: Verify Frontend Can Connect

**Browser Console - After backend is running:**
```javascript
const test = new WebSocket('ws://localhost:8000/ws/market');
test.onopen = () => {
  console.log('✅ WebSocket OPEN');
  console.log(test.readyState);  // Should be 1 (OPEN)
};
test.onerror = (e) => {
  console.error('❌ WebSocket ERROR:', e);
  console.error('Error details:', test.readyState);  // 0=CONNECTING, 3=CLOSED
};
test.onclose = () => console.log('🔌 Closed');
```

**Expected:**
```
✅ WebSocket OPEN
1
```

---

### STEP D: Check Market Data is Flowing

**Backend Terminal - look for:**
```
📊 Tick received: NIFTY @ 24500.00 | Volume: 500
📊 Order flow received for NIFTY: STRONG_BUY, Confidence: 0.87
```

**If NOT appearing:**
```
Solution:
1. Check if market hours (9:15 AM - 3:30 PM IST)
2. Run: python test_market_status_direct.py
3. Check Zerodha token validity
4. Restart backend service
```

---

## Diagnostic Test Script

**Create file: `test_websocket_order_flow.py`**

```python
import asyncio
import websockets
import json
from datetime import datetime

async def test_websocket():
    """Test WebSocket connection and data flow"""
    uri = "ws://localhost:8000/ws/market"
    
    print(f"🔌 Connecting to {uri}...")
    
    try:
        async with websockets.connect(uri) as websocket:
            print(f"✅ Connected! Waiting for order flow data...")
            
            tick_count = 0
            for symbol in ['NIFTY', 'BANKNIFTY', 'SENSEX']:
                for _ in range(5):  # Wait for 5 ticks per symbol
                    try:
                        message = await asyncio.wait_for(websocket.recv(), timeout=5)
                        data = json.loads(message)
                        
                        if data.get('type') == 'tick':
                            tick = data.get('data', {})
                            order_flow = tick.get('orderFlow', {})
                            
                            if order_flow.get('symbol'):
                                tick_count += 1
                                print(f"\n✅ Tick {tick_count} Received:")
                                print(f"   Symbol: {order_flow.get('symbol')}")
                                print(f"   Signal: {order_flow.get('signal')}")
                                print(f"   Confidence: {order_flow.get('signalConfidence'):.2%}")
                                print(f"   Delta: {order_flow.get('delta')}")
                    except asyncio.TimeoutError:
                        print(f"⏱️  Timeout waiting for {symbol} tick")
                        break
                        
    except ConnectionRefusedError:
        print(f"❌ Cannot connect to {uri}")
        print("   Solution: Start backend with: python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000")
    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == '__main__':
    asyncio.run(test_websocket())
```

**Run it:**
```bash
pip install websockets
python test_websocket_order_flow.py
```

**Expected Output:**
```
✅ Tick 1 Received:
   Symbol: NIFTY
   Signal: STRONG_BUY
   Confidence: 87%
   Delta: 5000
```

---

## Final Checklist

Before asking for support, verify:

- [ ] Backend is running (`uvicorn main:app --reload` running in terminal)
- [ ] Can reach `http://localhost:8000` in browser  
- [ ] Frontend WebSocket shows "connecting..." then "connected" in console
- [ ] Backend logs show "✅ Market Feed Status: ONLINE"
- [ ] Backend shows "🔌 Client connected" when frontend loads
- [ ] Backend shows "📊 Order flow received for NIFTY/BANKNIFTY/SENSEX"
- [ ] Frontend Smart Money section shows actual values (not "Loading...")
- [ ] Signals are updating in real-time (not stuck)

---

## Emergency Reset

If nothing works:

**Terminal 1:**
```bash
# Kill old processes
taskkill /F /IM python.exe

# Wait 2 seconds
timeout /t 2

# Clear cache
cd backend && python -m venv venv-clean
cd ..

# Fresh start
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

**Terminal 2:**
```bash
cd frontend
npm run build
npm start
```

**Browser:**
- Hard reload: `Ctrl + Shift + R`
- Visit: `http://localhost:3000`
- Open console: `F12`

---

## Real-Time Monitoring

**Start backend with maximum debug output:**
```bash
cd backend
export PYTHONANYWHERE=1  # Force Python to use stdout
python -u -m uvicorn main:app --reload --host 0.0.0.0 --port 8000 2>&1
```

**Monitor WebSocket in browser:**
```javascript
// Paste in console
const originalWS = WebSocket;
window.WebSocket = function(url, ...args) {
  console.log(`🔌 New WebSocket: ${url}`);
  const ws = new originalWS(url, ...args);
  const orig_send = ws.send;
  ws.send = function(msg) {
    console.log('📤 Sending:', msg.substring(0, 100));
    return orig_send.call(ws, msg);
  };
  return ws;
};

window.addEventListener('message', e => {
  if(e.data?.type === 'tick') {
    console.log('📥 Tick:', e.data.data?.symbol);
  }
});
```

---

## Next Steps After Fixing

Once order flow is loading:

1. Open DevTools Network tab → WS tab
2. Verify messages every tick (~0.1-1 second)
3. Check each message has `orderFlow` field with signal + confidence
4. Monitor for any error messages in console
5. Watch for WebSocket reconnections (should be rare)

---

**Need more help? Check these files:**
- Backend logs: Look for errors in terminal where you ran uvicorn
- Frontend console: Browser F12 → Console tab → Search for "Error" or "❌"
- Configuration: `/frontend/.env.local` for NEXT_PUBLIC_WS_URL
- WebSocket handler: `backend/routers/market.py`
- Order flow service: `backend/services/order_flow_analyzer.py`

