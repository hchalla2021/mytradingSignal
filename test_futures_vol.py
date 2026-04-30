"""Test if futures tokens have candle data with volume."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))
from config import get_settings
from kiteconnect import KiteConnect
from datetime import datetime, time, date
import pytz

IST = pytz.timezone("Asia/Kolkata")
cfg = get_settings()
kite = KiteConnect(api_key=cfg.zerodha_api_key)
kite.set_access_token(cfg.zerodha_access_token)

now = datetime.now(IST)
today = now.date()
from_dt = datetime.combine(today, time(9, 15), tzinfo=IST)
to_dt   = now

tokens = {
    "NIFTY_SPOT":      256265,
    "BANKNIFTY_SPOT":  260105,
    "SENSEX_SPOT":     265,
    "NIFTY_FUT":       cfg.nifty_fut_token,
    "BANKNIFTY_FUT":   cfg.banknifty_fut_token,
    "SENSEX_FUT":      cfg.sensex_fut_token,
}

for name, token in tokens.items():
    try:
        raw = kite.historical_data(token, from_dt, to_dt, "5minute")
        if raw:
            last = raw[-1]
            print(f"{name} ({token}): {len(raw)} candles, last_v={last.get('volume',0)}, last_t={last['date']}")
        else:
            print(f"{name} ({token}): EMPTY response")
    except Exception as e:
        print(f"{name} ({token}): ERROR {e}")
