#!/usr/bin/env python3
"""Verify timezone is set to IST (Asia/Kolkata), not UTC"""

import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

from datetime import datetime
import pytz
from config.market_session import get_market_session
from services.market_feed import get_market_status

print("\n" + "="*80)
print("🌍 TIMEZONE VERIFICATION")
print("="*80)

market_config = get_market_session()
print(f"\n🌐 Configured Timezone: {market_config.TIMEZONE}")

if market_config.TIMEZONE != "Asia/Kolkata":
    print(f"\n❌ WRONG TIMEZONE! Expected 'Asia/Kolkata', got '{market_config.TIMEZONE}'")
    print(f"   This will break market status calculations!")
else:
    print(f"✅ Timezone is correct: IST (Asia/Kolkata)")

IST = pytz.timezone(market_config.TIMEZONE)
now_ist = datetime.now(IST)
now_utc = datetime.now(pytz.UTC)

print(f"\n⏰ Current Time Comparison:")
print(f"   IST:  {now_ist.strftime('%Y-%m-%d %H:%M:%S %Z (UTC%z)')}")
print(f"   UTC:  {now_utc.strftime('%Y-%m-%d %H:%M:%S %Z (UTC%z)')}")

offset = now_ist.utcoffset().total_seconds() / 3600
print(f"   Offset: UTC+{offset:.1f} (should be UTC+5.5)")

if abs(offset - 5.5) < 0.1:
    print(f"✅ Timezone offset is correct!")
else:
    print(f"❌ Wrong offset! Expected +5.5 hours, got +{offset:.1f}")
    print(f"   Market times will be wrong!")

# Show what market status would be in UTC vs IST
print(f"\n📊 Market Status Calculation:")
ist_hour = now_ist.hour
ist_minute = now_ist.minute
utc_hour = now_utc.hour
utc_minute = now_utc.minute

print(f"   At IST {ist_hour:02d}:{ist_minute:02d} → Market is: {get_market_status()}")

if ist_hour >= 9 and ist_hour < 15:
    print(f"   At UTC {utc_hour:02d}:{utc_minute:02d} → Market would be: CLOSED (wrong!)")
else:
    # Calculate what status would be if we used UTC time
    if utc_hour >= 9 and utc_hour < 15:
        print(f"   If using UTC {utc_hour:02d}:{utc_minute:02d} → Would show: LIVE (wrong!)")
    else:
        print(f"   If using UTC {utc_hour:02d}:{utc_minute:02d} → Would show: CLOSED (which is correct)")

print("\n" + "="*80)
print("✅ YOUR TIMEZONE IS CORRECTLY SET TO IST" if market_config.TIMEZONE == "Asia/Kolkata" else "❌ TIMEZONE IS WRONG - NEEDS TO BE IST")
print("="*80 + "\n")
