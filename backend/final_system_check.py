#!/usr/bin/env python3
"""Final comprehensive system check"""

import requests
import json
from datetime import datetime
import pytz

print("\n" + "="*80)
print("🔍 FINAL SYSTEM CHECK - LIVE MARKET DATA FLOW")
print("="*80)

now = datetime.now(pytz.timezone('Asia/Kolkata'))
print(f"\n⏰ Current Time: {now.strftime('%H:%M:%S')} IST")

# 1. Check backend health
print("\n1️⃣ BACKEND HEALTH")
print("-" * 80)
try:
    r = requests.get('http://localhost:8000/health', timeout=5)
    if r.status_code == 200:
        data = r.json()
        print(f"   ✅ Backend: ONLINE")
        print(f"   Status: {data.get('status')}")
        print(f"   Service: {data.get('service')}")
    else:
        print(f"   ❌ Backend: HTTP {r.status_code}")
except Exception as e:
    print(f"   ❌ Backend: {e}")

# 2. Check market data API
print("\n2️⃣ MARKET DATA API (/api/market/live)")
print("-" * 80)
try:
    r = requests.get('http://localhost:8000/api/market/live', timeout=5)
    if r.status_code == 200:
        data = r.json()
        print(f"   ✅ API: RESPONDING")
        print(f"   Status: {data.get('status')}")
        
        indices = data.get('data', [])
        print(f"\n   📊 Indices Data:")
        for idx in indices[:3]:
            print(f"      • {idx['index']}: ₹{idx['ltp']:.2f} ({idx['change']:+.2f}%)")
        
        if len(indices) == 0:
            print(f"      ❌ NO DATA!")
    else:
        print(f"   ❌ API Error: {r.status_code}")
except Exception as e:
    print(f"   ❌ API Error: {e}")

# 3. Check market status
print("\n3️⃣ MARKET STATUS ENDPOINT")
print("-" * 80)
try:
    r = requests.get('http://localhost:8000/api/diagnostics/market-status', timeout=5)
    if r.status_code == 200:
        data = r.json()
        status = data.get('market_status')
        print(f"   ✅ Status: {status}")
        
        if status == 'CLOSED':
            print(f"   ⚠️  MARKET IS SHOWING AS CLOSED!")
            print(f"   This is the problem - frontend will show 'MARKET CLOSED'")
        elif status == 'LIVE':
            print(f"   ✅ Market is LIVE - Should show prices in UI")
    else:
        print(f"   ❌ Error: {r.status_code}")
except Exception as e:
    print(f"   ❌ Error: {e}")

# 4. Check cache status
print("\n4️⃣ CACHE STATUS")
print("-" * 80)
try:
    r = requests.get('http://localhost:8000/api/diagnostics/cache-status', timeout=5)
    if r.status_code == 200:
        data = r.json()
        print(f"   ✅ Cache: {data.get('status')}")
        symbols = data.get('cached_symbols', [])
        print(f"   Symbols cached: {len(symbols)}")
        if symbols:
            print(f"   Sample: {', '.join(symbols[:3])}")
    else:
        print(f"   ❌ Error: {r.status_code}")
except Exception as e:
    print(f"   ❌ Error: {e}")

# 5. Frontend status
print("\n5️⃣ FRONTEND STATUS")
print("-" * 80)
for port in [3000, 3001, 3002, 3003]:
    try:
        r = requests.get(f'http://localhost:{port}', timeout=2)
        print(f"   ✅ Frontend: Running on port {port}")
        break
    except:
        pass
else:
    print(f"   ❌ Frontend: NOT FOUND on ports 3000-3003")

print("\n" + "="*80)
print("SUMMARY")
print("="*80)
print("""
If you see this:
✅ ALL GREEN - Hard refresh browser (Ctrl+Shift+R) and wait 10 seconds
❌ Market showing CLOSED - There's an issue with market status calculation
❌ Backend OFFLINE - Check terminal running backend server
❌ Frontend NOT FOUND - Check terminal running 'npm run dev'
""")
print("="*80 + "\n")
