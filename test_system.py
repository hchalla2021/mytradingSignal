#!/usr/bin/env python3
"""Test market status and WebSocket data after timezone fix"""

import asyncio
import websockets
import json
import requests
from datetime import datetime
import pytz

print("\n" + "="*80)
print("🔍 MARKET STATUS & DATA TEST")
print("="*80)

# 1. Check market status via API
print("\n1️⃣ CHECKING MARKET STATUS API...")
try:
    r = requests.get('http://localhost:8000/api/system/health/market', timeout=5).json()
    status = r.get('phase')
    print(f"   Market Status: {status}")
    
    if status == "LIVE":
        print(f"   ✅ CORRECT! Market is LIVE")
    elif status == "CLOSED":
        print(f"   ❌ WRONG! Should be LIVE at this time")
        ist = pytz.timezone('Asia/Kolkata')
        now = datetime.now(ist)
        print(f"      Current time IST: {now.strftime('%H:%M:%S')}")
except Exception as e:
    print(f"   ❌ Error: {e}")

# 2. Check market feed
print("\n2️⃣ CHECKING MARKET FEED API...")
try:
    r = requests.get('http://localhost:8000/api/system/health/feed', timeout=5).json()
    print(f"   Feed state: {r.get('state')}")
    print(f"   Feed healthy: {r.get('is_healthy')}")
    print(f"   Total ticks: {r.get('total_ticks', 0)}")
except Exception as e:
    print(f"   ❌ API Error: {e}")

# 3. Test WebSocket snapshot
print("\n3️⃣ TESTING WEBSOCKET SNAPSHOT...")
async def test_ws():
    try:
        async with websockets.connect('ws://localhost:8000/ws/market', ping_interval=20) as ws:
            print(f"   ✅ Connected to WebSocket")
            
            for i in range(10):
                try:
                    msg = await asyncio.wait_for(ws.recv(), timeout=1)
                    data = json.loads(msg)
                    msg_type = data.get('type')
                    
                    if msg_type == 'snapshot':
                        symbols = list(data.get('data', {}).keys())
                        print(f"   ✅ SNAPSHOT received with {len(symbols)} symbols")
                        for sym in symbols:
                            price = data['data'][sym].get('price')
                            print(f"      {sym}: ₹{price:.2f}")
                        return True
                    else:
                        print(f"   📨 Received: {msg_type}")
                except asyncio.TimeoutError:
                    pass
            
            print(f"   ❌ No snapshot received after waiting")
            return False
    except Exception as e:
        print(f"   ❌ WebSocket Error: {e}")
        return False

result = asyncio.run(test_ws())

print("\n" + "="*80)
if result:
    print("✅ ALL TESTS PASSED - DATA IS FLOWING")
else:
    print("❌ TESTS FAILED - DATA NOT FLOWING")
print("="*80 + "\n")
