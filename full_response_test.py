#!/usr/bin/env python3
import requests
import json

print("\n=== FULL RESPONSE FROM /api/analysis/analyze/NIFTY ===\n")
try:
    r = requests.get("http://localhost:8000/api/analysis/analyze/NIFTY", timeout=5)
    data = r.json()
    
    # Show full indicators dict keys
    indicators = data.get('indicators', {})
    print("Indicators keys present:")
    for key in sorted(indicators.keys()):
        val = indicators[key]
        if isinstance(val, (int, float)):
            print(f"  ✓ {key}: {val}")
        elif isinstance(val, str):
            print(f"  ✓ {key}: '{val}'")
        elif val is None:
            print(f"  ✓ {key}: None")
        else:
            print(f"  ✓ {key}: {type(val).__name__}")
    
    # Specifically check for RSI
    print(f"\n❓ RSI fields:")
    print(f"  rsi_5m: {indicators.get('rsi_5m', 'MISSING')}")
    print(f"  rsi_15m: {indicators.get('rsi_15m', 'MISSING')}")
    print(f"  rsi_5m_signal: {indicators.get('rsi_5m_signal', 'MISSING')}")
    
except Exception as e:
    print(f"ERROR: {e}")
