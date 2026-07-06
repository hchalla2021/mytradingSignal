"""Probe: are configured futures tokens valid for the current month? Do they return volume?"""
import sys

sys.path.insert(0, "backend")

from kiteconnect import KiteConnect  # noqa: E402

from config import get_settings  # noqa: E402

s = get_settings()
print(f"Configured tokens: NIFTY_FUT={s.nifty_fut_token} BANKNIFTY_FUT={s.banknifty_fut_token} SENSEX_FUT={s.sensex_fut_token}")

kite = KiteConnect(api_key=s.zerodha_api_key)
kite.set_access_token(s.zerodha_access_token)

try:
    nfo = kite.instruments("NFO")
    bfo = kite.instruments("BFO")
except Exception as e:  # noqa: BLE001
    print("instruments() FAILED:", type(e).__name__, e)
    sys.exit(1)

tok_map = {i["instrument_token"]: i for i in nfo + bfo}

for name, tok in (("NIFTY", s.nifty_fut_token), ("BANKNIFTY", s.banknifty_fut_token), ("SENSEX", s.sensex_fut_token)):
    inst = tok_map.get(tok)
    if inst:
        print(f"{name}: token {tok} -> {inst['exchange']}:{inst['tradingsymbol']} expiry={inst['expiry']}")
    else:
        print(f"{name}: token {tok} -> NOT FOUND in NFO/BFO instruments (STALE/EXPIRED)")

# What are the actual current-month futures?
import datetime  # noqa: E402

today = datetime.date.today()
for base, pool in (("NIFTY", nfo), ("BANKNIFTY", nfo), ("SENSEX", bfo)):
    futs = [
        i for i in pool
        if i["segment"] in ("NFO-FUT", "BFO-FUT")
        and i["name"] == base
        and i["expiry"] >= today
    ]
    futs.sort(key=lambda i: i["expiry"])
    if futs:
        f = futs[0]
        print(f"CURRENT {base} future: {f['exchange']}:{f['tradingsymbol']} token={f['instrument_token']} expiry={f['expiry']}")
        try:
            q = kite.quote([f"{f['exchange']}:{f['tradingsymbol']}"])
            for k, v in q.items():
                print(f"   quote volume={v.get('volume')} oi={v.get('oi')} last_price={v.get('last_price')}")
        except Exception as e:  # noqa: BLE001
            print("   quote FAILED:", e)
