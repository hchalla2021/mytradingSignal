import collections
import time
from dotenv import dotenv_values
from kiteconnect import KiteTicker

env = dotenv_values(r"C:\Tradings\mytradingSignal\backend\.env")
api_key = (env.get("ZERODHA_API_KEY") or "").strip()
token = (env.get("ZERODHA_ACCESS_TOKEN") or "").strip()
tokens = {256265: "NIFTY spot", 260105: "BANKNIFTY spot", 265: "SENSEX spot",
          15736578: "NIFTY FUT", 15735298: "BANKNIFTY FUT", 281837829: "SENSEX FUT"}
events, counts, last = [], collections.Counter(), {}

kws = KiteTicker(api_key, token)

def on_connect(ws, resp):
    events.append("connected")
    ws.subscribe(list(tokens))
    ws.set_mode(ws.MODE_FULL, list(tokens))

def on_ticks(ws, ticks):
    now = time.time()
    for t in ticks:
        counts[t["instrument_token"]] += 1
        last[t["instrument_token"]] = now

kws.on_connect = on_connect
kws.on_ticks = on_ticks
kws.on_error = lambda ws, code, reason: events.append(f"error {code} {str(reason)[:160]}")
kws.on_close = lambda ws, code, reason: events.append(f"close {code} {str(reason)[:160]}")
kws.on_noreconnect = lambda ws: events.append("noreconnect")
kws.connect(threaded=True)
start = time.time()
time.sleep(30)
print("events:", events)
for tk, name in tokens.items():
    age = (time.time() - last[tk]) if tk in last else None
    print(f"{name:16} ticks={counts[tk]:4d} last_age={'-' if age is None else round(age, 1)}")
try:
    kws.close()
except Exception:
    pass
