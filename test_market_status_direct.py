#!/usr/bin/env python3
"""Direct test of market_feed.get_market_status() function"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent / "backend"))

from datetime import datetime
import pytz
from services.market_feed import get_market_status, IST

print("\n" + "="*80)
print("🔍 MARKET STATUS FUNCTION TEST")
print("="*80)

# Get current time in IST
now_ist = datetime.now(IST)
print(f"\n⏰ Current Time (IST): {now_ist.strftime('%Y-%m-%d %H:%M:%S %Z')}")
print(f"   Hour: {now_ist.hour}, Minute: {now_ist.minute}")

# Test market status
status = get_market_status()
print(f"\n📊 Market Status from get_market_status(): {status}")

# Show what SHOULD be status
if now_ist.hour == 9 and now_ist.minute < 7:
    expected = "PRE_OPEN"
elif now_ist.hour == 9 and 7 <= now_ist.minute < 15:
    expected = "FREEZE"
elif 9 <= now_ist.hour < 15 or (now_ist.hour == 15 and now_ist.minute == 0):
    expected = "LIVE"
else:
    expected = "CLOSED"

print(f"   Expected: {expected}")

if status == expected:
    print(f"   ✅ CORRECT!")
else:
    print(f"   ❌ WRONG! Status is {status} but should be {expected}")
    print(f"\n   This is why the UI shows MARKET CLOSED!")

print("\n" + "="*80 + "\n")
