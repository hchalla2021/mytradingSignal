#!/usr/bin/env python3
import requests
r = requests.get('http://localhost:8000/api/market/live', timeout=5).json()
print(f"Status: {r.get('status')}")
for idx in r.get('data', [])[:3]:
    print(f"{idx['index']}: ₹{idx['ltp']:.2f} ({idx['change']:+.2f}%)")
