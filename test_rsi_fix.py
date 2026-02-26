#!/usr/bin/env python3
import requests
import json

print("\n=== RSI VALUES FROM MAIN ANALYSIS ENDPOINT ===\n")
for s in ['NIFTY','BANKNIFTY','SENSEX']:
    try:
        r = requests.get(f"http://localhost:8000/api/analysis/analyze/{s}", timeout=5).json()
        indicators = r.get('indicators', {})
        
        rsi_5m = indicators.get('rsi_5m', 'N/A')
        rsi_15m = indicators.get('rsi_15m', 'N/A')
        change = indicators.get('change', 0)
        
        if rsi_5m == 'N/A':
            print(f"{s:12} → ❌ RSI fields NOT in indicators (missing from backend)")
        else:
            match = "✅ DIFFERENT" if rsi_5m != rsi_15m else "❌ IDENTICAL"
            print(f"{s:12} → 5m={rsi_5m:6.1f} | 15m={rsi_15m:6.1f} | Change={change:+.2f}% | {match}")
    except Exception as e:
        print(f"{s:12} → ERROR: {e}")

print("\n✅ If values differ → Fix is working!")
print("❌ If values identical → Backend needs restart\n")
