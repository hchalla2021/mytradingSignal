#!/usr/bin/env python3
"""Quick diagnostic to check market status and WebSocket data"""

from datetime import datetime
import pytz
import requests

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

# Check market and feed APIs
try:
    print('\n📡 Checking Market Status...')
    r = requests.get('http://localhost:8000/api/system/health/market', timeout=5)
    if r.status_code == 200:
        data = r.json()
        print(f'✅ API Response Status: {data.get("phase")}')
        print(f'   Trading hours: {data.get("is_trading_hours")}')
    else:
        print(f'❌ API Error: {r.status_code}')
except Exception as e:
    print(f'❌ API Error: {e}')

# Check feed
try:
    print('\n🔍 Checking Feed Connection...')
    r = requests.get('http://localhost:8000/api/system/health/feed', timeout=5)
    if r.status_code == 200:
        data = r.json()
        print(f'Feed State: {data.get("state")}')
        print(f'Feed Healthy: {data.get("is_healthy")}')
        print(f'Total Ticks: {data.get("total_ticks", 0)}')
    else:
        print(f'Feed check error: HTTP {r.status_code}')
except Exception as e:
    print(f'Feed check error: {e}')
