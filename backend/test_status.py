#!/usr/bin/env python3
import sys
sys.path.insert(0, '.')
from services.market_feed import get_market_status
from datetime import datetime
import pytz

ist = pytz.timezone('Asia/Kolkata')
now = datetime.now(ist)
status = get_market_status()

print(f"Time: {now.strftime('%H:%M:%S')} IST")
print(f"Market Status: {status}")

if 9 <= now.hour < 15:
    if status != "LIVE" and status != "PRE_OPEN" and status != "FREEZE":
        print("❌ WRONG! Should not show CLOSED during market hours!")
    else:
        print("✅ Correct!")
else:
    print("ℹ️ Market is closed at this time of day")
