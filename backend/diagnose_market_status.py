#!/usr/bin/env python3
"""Diagnose why market status shows CLOSED when it should be LIVE"""

import sys
from datetime import datetime
import pytz

# Add backend to path
sys.path.insert(0, '.')

from config.market_session import get_market_session
from config.nse_holidays import is_holiday, get_holiday_name, NSE_HOLIDAYS
from services.market_feed import get_market_status, is_market_open

print("\n" + "="*80)
print("🔍 MARKET STATUS DIAGNOSTICS")
print("="*80)

# Get current time
market_config = get_market_session()
IST = pytz.timezone(market_config.TIMEZONE)
now = datetime.now(IST)

print(f"\n📅 CURRENT TIME:")
print(f"   Date: {now.strftime('%A, %B %d, %Y')}")
print(f"   Time: {now.strftime('%I:%M:%S %p')} IST")
print(f"   Timestamp: {now.isoformat()}")

# Check day of week
print(f"\n📆 DAY OF WEEK:")
weekday = now.weekday()  # 0=Monday, 6=Sunday
weekday_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
print(f"   Day: {weekday_names[weekday]} (index={weekday})")
print(f"   Is Weekday (Mon-Fri): {weekday < 5}")
print(f"   Weekend Days Config: {market_config.WEEKEND_DAYS}")

# Check holiday
date_str = now.strftime("%Y-%m-%d")
is_hol = is_holiday(date_str)
print(f"\n🎉 HOLIDAY CHECK:")
print(f"   Date String: {date_str}")
print(f"   Is Holiday: {is_hol}")
if is_hol:
    print(f"   Holiday Name: {get_holiday_name(date_str)}")

# Show available holidays
print(f"\n📋 CONFIGURED HOLIDAYS:")
holidays_2026 = [h for h in NSE_HOLIDAYS.keys() if h.startswith('2026')]
if holidays_2026:
    print(f"   2026 Holidays: {len(holidays_2026)} configured")
    for h in holidays_2026[:5]:  # Show first 5
        print(f"      - {h}: {NSE_HOLIDAYS[h]}")
else:
    print(f"   ⚠️  NO 2026 HOLIDAYS CONFIGURED!")
    print(f"   Only 2025 holidays are in the system")

# Check market timings
current_time = now.time()
print(f"\n⏰ MARKET TIMINGS (IST):")
print(f"   PRE-OPEN START: {market_config.PRE_OPEN_START.strftime('%I:%M %p')}")
print(f"   PRE-OPEN END:   {market_config.PRE_OPEN_END.strftime('%I:%M %p')}")
print(f"   MARKET OPEN:    {market_config.MARKET_OPEN.strftime('%I:%M %p')}")
print(f"   MARKET CLOSE:   {market_config.MARKET_CLOSE.strftime('%I:%M %p')}")
print(f"   Current Time:   {current_time.strftime('%I:%M %p')}")

# Time range checks
print(f"\n🔍 TIME RANGE CHECKS:")
print(f"   Before Pre-Open:  {current_time < market_config.PRE_OPEN_START}")
print(f"   In Pre-Open:      {market_config.PRE_OPEN_START <= current_time < market_config.PRE_OPEN_END}")
print(f"   In Freeze:        {market_config.PRE_OPEN_END <= current_time < market_config.MARKET_OPEN}")
print(f"   In Live Trading:  {market_config.MARKET_OPEN <= current_time <= market_config.MARKET_CLOSE}")
print(f"   After Market:     {current_time > market_config.MARKET_CLOSE}")

# Get actual market status
status = get_market_status()
is_open = is_market_open()

print(f"\n📊 MARKET STATUS:")
print(f"   Status: {status}")
print(f"   Is Open: {is_open}")

# Decision tree
print(f"\n🔍 DECISION TREE:")
if weekday in market_config.WEEKEND_DAYS:
    print(f"   ❌ CLOSED: Weekend ({weekday_names[weekday]})")
elif is_hol:
    print(f"   ❌ CLOSED: Holiday ({get_holiday_name(date_str)})")
elif current_time < market_config.PRE_OPEN_START:
    print(f"   ❌ CLOSED: Before market hours (opens at {market_config.MARKET_OPEN.strftime('%I:%M %p')})")
elif market_config.PRE_OPEN_START <= current_time < market_config.PRE_OPEN_END:
    print(f"   🟡 PRE-OPEN: Auction matching phase")
elif market_config.PRE_OPEN_END <= current_time < market_config.MARKET_OPEN:
    print(f"   🟡 FREEZE: Price discovery phase")
elif market_config.MARKET_OPEN <= current_time <= market_config.MARKET_CLOSE:
    print(f"   ✅ LIVE: Market is trading")
else:
    print(f"   ❌ CLOSED: After market hours (closed at {market_config.MARKET_CLOSE.strftime('%I:%M %p')})")

# Check if scheduler is enabled
print(f"\n⏰ SCHEDULER STATUS:")
from config import get_settings
settings = get_settings()
print(f"   Scheduler Enabled: {settings.enable_scheduler}")
print(f"   Auto-start Time: 08:55 AM IST")
print(f"   Auto-stop Time: 03:35 PM IST")

# Check auth status
print(f"\n🔐 AUTHENTICATION STATUS:")
from services.auth_state_machine import auth_state_manager
auth_state_manager.force_recheck()
print(f"   Is Authenticated: {auth_state_manager.is_authenticated}")
print(f"   Current State: {auth_state_manager.current_state}")
print(f"   Requires Login: {auth_state_manager.requires_login}")
if settings.zerodha_access_token:
    print(f"   Token Present: Yes ({settings.zerodha_access_token[:20]}...)")
else:
    print(f"   Token Present: No")

print("\n" + "="*80)
print("DIAGNOSIS COMPLETE")
print("="*80 + "\n")

# Provide recommendations
print("💡 RECOMMENDATIONS:")
if weekday in market_config.WEEKEND_DAYS:
    print("   ℹ️  Today is a weekend - market is closed")
elif is_hol:
    print("   ℹ️  Today is a holiday - market is closed")
elif not holidays_2026:
    print("   ⚠️  WARNING: No 2026 holidays configured!")
    print("   💡 Add 2026 holidays to backend/config/nse_holidays.py")
elif not auth_state_manager.is_authenticated:
    print("   ⚠️  WARNING: Not authenticated with Zerodha!")
    print("   💡 Click LOGIN in UI or run: python quick_token_fix.py")
elif not settings.enable_scheduler:
    print("   ⚠️  WARNING: Scheduler is disabled!")
    print("   💡 Enable scheduler in .env: ENABLE_SCHEDULER=true")
elif status == "CLOSED" and market_config.MARKET_OPEN <= current_time <= market_config.MARKET_CLOSE:
    print("   ⚠️  BUG DETECTED: Market should be LIVE but showing CLOSED!")
    print("   💡 Check timezone configuration and system clock")
else:
    print("   ✅ All checks passed - market status is correct")

print()
