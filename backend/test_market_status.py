#!/usr/bin/env python3
"""Direct test of market status function"""

import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent))

from datetime import datetime
import pytz
from config.market_session import get_market_session
from config.nse_holidays import is_holiday
from services.market_feed import get_market_status

# Check
now = datetime.now(pytz.timezone('Asia/Kolkata'))
print(f'\n⏰ Current Time: {now.strftime("%Y-%m-%d %H:%M:%S")} (IST)')
print(f'📆 Day of Week: {now.strftime("%A")} (0=Mon, 5=Sat, 6=Sun)')

market_config = get_market_session()
print(f'\n🕐 Market Config:')
print(f'   PRE_OPEN: {market_config.PRE_OPEN_START} - {market_config.PRE_OPEN_END}')
print(f'   LIVE: {market_config.MARKET_OPEN} - {market_config.MARKET_CLOSE}')
print(f'   Weekend Days: {market_config.WEEKEND_DAYS}')

print(f'\n🔍 Status Checks:')
print(f'   Is Weekend? {now.weekday() in market_config.WEEKEND_DAYS}')

date_str = now.strftime("%Y-%m-%d")
holiday_status = is_holiday(date_str)
print(f'   Is Holiday ({date_str})? {holiday_status}')

market_status = get_market_status()
print(f'\n✅ MARKET STATUS: {market_status}')

# Double check the time comparison
current_time = now.time()
print(f'\n🔬 Time Comparison:')
print(f'   current_time = {current_time}')
print(f'   PRE_OPEN_START = {market_config.PRE_OPEN_START}')
print(f'   PRE_OPEN_END = {market_config.PRE_OPEN_END}')
print(f'   MARKET_OPEN = {market_config.MARKET_OPEN}')
print(f'   MARKET_CLOSE = {market_config.MARKET_CLOSE}')
print(f'   {market_config.MARKET_OPEN} <= {current_time} <= {market_config.MARKET_CLOSE} = {market_config.MARKET_OPEN <= current_time <= market_config.MARKET_CLOSE}')
