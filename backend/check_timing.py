#!/usr/bin/env python3

from datetime import datetime, time
from zoneinfo import ZoneInfo

IST = ZoneInfo('Asia/Kolkata')
now = datetime.now(IST)
current_time = now.time()

print(f'Current IST time: {now.strftime("%Y-%m-%d %H:%M:%S %A")}')
print(f'Current time: {current_time}')
print(f'Is weekday: {now.weekday() < 5}')

PRE_OPEN_START = time(9, 0, 0)
MARKET_CLOSE = time(15, 30, 0)
AUTO_START_TIME = time(8, 55, 0)
AUTO_STOP_TIME = time(15, 35, 0)

print(f'AUTO_START_TIME: {AUTO_START_TIME}')
print(f'PRE_OPEN_START: {PRE_OPEN_START}')
print(f'MARKET_CLOSE: {MARKET_CLOSE}')
print(f'AUTO_STOP_TIME: {AUTO_STOP_TIME}')

should_be_running = (now.weekday() < 5 and AUTO_START_TIME <= current_time <= AUTO_STOP_TIME)
print(f'Should market feed be running: {should_be_running}')

in_market_hours = (now.weekday() < 5 and PRE_OPEN_START <= current_time <= MARKET_CLOSE)
print(f'In market hours: {in_market_hours}')