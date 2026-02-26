#!/usr/bin/env python3
import requests
for s in ['NIFTY','BANKNIFTY','SENSEX']:
    try:
        r = requests.get(f"http://localhost:8000/api/analysis/rsi-momentum/{s}", timeout=5).json()
        print(f"{s:12} → RSI 5m={r.get('rsi_5m'):6} | 15m={r.get('rsi_15m'):6} | Signal: {r.get('rsi_momentum_status')}")
    except Exception as e:
        print(f"{s:12} → ERROR: {e}")
