import statistics
import time
from datetime import timezone, timedelta
from dotenv import dotenv_values
from kiteconnect import KiteTicker

IST = timezone(timedelta(hours=5, minutes=30))
env = dotenv_values(r"C:\Tradings\mytradingSignal\backend\.env")
api_key = (env.get("ZERODHA_API_KEY") or "").strip()
token = (env.get("ZERODHA_ACCESS_TOKEN") or "").strip()
tokens = {256265: "NIFTY spot", 260105: "BANKNIFTY spot", 265: "SENSEX spot",
          15736578: "NIFTY FUT", 15735298: "BANKNIFTY FUT", 281837829: "SENSEX FUT"}
skews = {name: [] for name in tokens.values()}
missing = {name: 0 for name in tokens.values()}

kws = KiteTicker(api_key, token)


def on_connect(ws, resp):
    ws.subscribe(list(tokens))
    ws.set_mode(ws.MODE_FULL, list(tokens))


def on_ticks(ws, ticks):
    now = time.time()
    for t in ticks:
        name = tokens.get(t["instrument_token"])
        if not name:
            continue
        ts = t.get("exchange_timestamp")
        if ts is None:
            missing[name] += 1
            continue
        epoch = ts.replace(tzinfo=IST).timestamp() if ts.tzinfo is None else ts.timestamp()
        skews[name].append(now - epoch)


kws.on_connect = on_connect
kws.on_ticks = on_ticks
kws.connect(threaded=True)
time.sleep(40)
print("local now:", time.strftime("%H:%M:%S"))
for name, values in skews.items():
    if not values:
        print(f"{name:16} no exchange_timestamp ticks (missing={missing[name]})")
        continue
    neg = sum(1 for v in values if v < 0)
    over = sum(1 for v in values if v > 5)
    print(f"{name:16} n={len(values):4d} min={min(values):6.2f} median={statistics.median(values):6.2f} "
          f"max={max(values):6.2f} negative={neg} over5s={over} missing={missing[name]}")
try:
    kws.close()
except Exception:
    pass
