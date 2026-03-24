import pytz
from datetime import datetime, time
IST = pytz.timezone('Asia/Kolkata')
now = datetime.now(IST)
print(f'System time: {datetime.now()}')
print(f'IST time: {now}')
print(f'current_time: {now.time()}')
print(f'weekday: {now.weekday()} (0=Mon, 5=Sat, 6=Sun)')
MO = time(9, 15)
MC = time(15, 30)
print(f'MARKET_OPEN={MO}, MARKET_CLOSE={MC}')
print(f'in range: {MO <= now.time() <= MC}')
date_str = now.strftime('%Y-%m-%d')
print(f'date_str: {date_str}')
