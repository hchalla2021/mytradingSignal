import sys
from dotenv import dotenv_values
from kiteconnect import KiteConnect

env = dotenv_values(r"C:\Tradings\mytradingSignal\backend\.env")
api_key = (env.get("ZERODHA_API_KEY") or "").strip()
token = (env.get("ZERODHA_ACCESS_TOKEN") or "").strip()
print("api_key_len", len(api_key), "token_len", len(token))
kite = KiteConnect(api_key=api_key)
kite.set_access_token(token)
try:
    profile = kite.profile()
    print("REST profile OK; broker =", profile.get("broker"), "; user_type =", profile.get("user_type"))
except Exception as exc:
    print("REST profile FAILED:", type(exc).__name__, str(exc)[:300])
    sys.exit(1)

try:
    ltp = kite.ltp(["NSE:NIFTY 50"])
    print("REST ltp OK:", {k: v.get("last_price") for k, v in ltp.items()})
except Exception as exc:
    print("REST ltp FAILED:", type(exc).__name__, str(exc)[:300])
