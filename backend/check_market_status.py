#!/usr/bin/env python3
"""Quick diagnostic to check market status and WebSocket data"""

from datetime import datetime
import pytz
import requests
import json

# Check time
ist = pytz.timezone('Asia/Kolkata')
now = datetime.now(ist)
print(f'\n📅 Current Time (IST): {now.strftime("%H:%M:%S")} on {now.strftime("%A")}')

# Market phases
if now.hour == 9 and now.minute < 7:
    expected_status = 'PRE_OPEN (9:00-9:07)'
elif now.hour == 9 and 7 <= now.minute < 15:
    expected_status = 'FREEZE (9:07-9:15)'
elif (now.hour >= 9 and now.hour < 15) or (now.hour == 15 and now.minute == 0):
    expected_status = 'LIVE (9:15-15:30)'
else:
    expected_status = 'CLOSED'

print(f'🕐 Expected Market Status: {expected_status}')

# Check API
try:
    print('\n📡 Checking Backend API...')
    r = requests.get('http://localhost:8000/api/market/live', timeout=5)
    if r.status_code == 200:
        data = r.json()
        print(f'✅ API Response Status: {data.get("status")}')
        
        indices = data.get('data', [])
        if indices:
            print(f'\n📊 Market Indices Data:')
            for idx in indices[:3]:
                print(f'   {idx["index"]}: ₹{idx["ltp"]:.2f} ({idx["change"]:+.2f}%)')
        else:
            print('❌ No market indices data!')
    else:
        print(f'❌ API Error: {r.status_code}')
except Exception as e:
    print(f'❌ API Error: {e}')

# Check cache
try:
    print('\n🔍 Checking Cache Data...')
    r = requests.get('http://localhost:8000/api/diagnostics/cache-status', timeout=5)
    if r.status_code == 200:
        data = r.json()
        print(f'Cache Status: {data.get("status")}')
        symbols = data.get('cached_symbols', [])
        if symbols:
            print(f'Cached Symbols ({len(symbols)}): {", ".join(symbols[:3])}')
except Exception as e:
    print(f'Cache check error: {e}')
