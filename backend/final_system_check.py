#!/usr/bin/env python3
"""Final comprehensive system check"""

import requests
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

# 2. Check feed connection
print("\n2️⃣ MARKET FEED CONNECTION")
print("-" * 80)
try:
    r = requests.get('http://localhost:8000/api/system/health/feed', timeout=5)
    if r.status_code == 200:
        data = r.json()
        print(f"   ✅ Feed endpoint: RESPONDING")
        print(f"   State: {data.get('state')}")
        print(f"   Healthy: {data.get('is_healthy')}")
        print(f"   Reconnect required: {data.get('requires_reconnect')}")
        print(f"   Total ticks: {data.get('total_ticks', 0)}")
    else:
        print(f"   ❌ Feed Error: {r.status_code}")
except Exception as e:
    print(f"   ❌ Feed Error: {e}")

# 3. Check market status
print("\n3️⃣ MARKET STATUS ENDPOINT")
print("-" * 80)
try:
    r = requests.get('http://localhost:8000/api/system/health/market', timeout=5)
    if r.status_code == 200:
        data = r.json()
        status = data.get('phase')
        print(f"   ✅ Status: {status}")
        
        if status == 'CLOSED':
            print(f"   ℹ️  Market is currently closed; no live ticks are expected")
        elif status == 'LIVE':
            print(f"   ✅ Market is LIVE - Should show prices in UI")
    else:
        print(f"   ❌ Error: {r.status_code}")
except Exception as e:
    print(f"   ❌ Error: {e}")

# 4. Check aggregate health
print("\n4️⃣ SYSTEM HEALTH SUMMARY")
print("-" * 80)
try:
    r = requests.get('http://localhost:8000/api/system/health/summary', timeout=5)
    if r.status_code == 200:
        data = r.json()
        print(f"   ✅ Overall healthy: {data.get('healthy')}")
        print(f"   Auth valid: {data.get('auth_valid')}")
        print(f"   Feed healthy: {data.get('feed_healthy')}")
        print(f"   Action required: {data.get('requires_action')}")
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
ℹ️ Market CLOSED - No live ticks are expected outside trading hours
❌ Backend OFFLINE - Check terminal running backend server
❌ Frontend NOT FOUND - Check terminal running 'npm run dev'
""")
print("="*80 + "\n")
