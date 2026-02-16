#!/usr/bin/env python3
"""Quick check of market status"""
from datetime import datetime
import pytz

IST = pytz.timezone("Asia/Kolkata")
now = datetime.now(IST)

print(f"Current IST Time: {now.strftime('%A, %B %d, %Y %I:%M:%S %p')}")
print(f"Weekday: {now.weekday()} (0=Mon, 6=Sun)")
print(f"Is Weekend: {now.weekday() in [5, 6]}")

# Check if Feb 16, 2026 is a Sunday
if now.weekday() == 6:
    print("\n⚠️  TODAY IS SUNDAY - Market is closed!")
elif now.weekday() == 5:
    print("\n⚠️  TODAY IS SATURDAY - Market is closed!")
else:
    print(f"\n✅ Today is a weekday - Market should be open")

# Check current time
current_time = now.time()
from datetime import time
market_open = time(9, 15)
market_close = time(15, 30)

print(f"\nCurrent time: {current_time}")
print(f"Market hours: {market_open} - {market_close}")

if market_open <= current_time <= market_close:
    print("✅ Within market hours")
else:
    print("❌ Outside market hours")
