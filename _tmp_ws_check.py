import time
from dotenv import dotenv_values
from kiteconnect import KiteTicker

env = dotenv_values(r"C:\Tradings\mytradingSignal\backend\.env")
api_key = (env.get("ZERODHA_API_KEY") or "").strip()
token = (env.get("ZERODHA_ACCESS_TOKEN") or "").strip()
events = []
ticks = []

kws = KiteTicker(api_key, token)
kws.on_connect = lambda ws, resp: (events.append("connected"), ws.subscribe([256265]), ws.set_mode(ws.MODE_LTP, [256265]))
kws.on_ticks = lambda ws, t: ticks.extend(t)
kws.on_error = lambda ws, code, reason: events.append(f"error code={code} reason={str(reason)[:200]}")
kws.on_close = lambda ws, code, reason: events.append(f"close code={code} reason={str(reason)[:200]}")
kws.on_noreconnect = lambda ws: events.append("noreconnect")
kws.connect(threaded=True)
deadline = time.time() + 15
while time.time() < deadline and not ticks:
    time.sleep(0.5)
print("events:", events)
print("ticks received:", len(ticks), "first price:", ticks[0].get("last_price") if ticks else None)
try:
    kws.close()
except Exception:
    pass
