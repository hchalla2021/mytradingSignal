#!/usr/bin/env python3
import requests

print("\n=== CHECKING ACTUAL MARKET DATA ===\n")
for s in ['NIFTY','BANKNIFTY','SENSEX']:
    try:
        r = requests.get(f"http://localhost:8000/api/analysis/analyze/{s}", timeout=5).json()
        ind = r.get('indicators', {})
        
        price = ind.get('price', 0)
        change = ind.get('changePercent', 0)
        rsi_5m = ind.get('rsi_5m', 'MISSING')
        rsi_15m = ind.get('rsi_15m', 'MISSING')
        
        if rsi_5m == 'MISSING':
            print(f"{s:12} → Price={price:8.2f} | Change={change:+.3f}% | RSI=MISSING (backend still old code)")
        else:
            calc = "✅ CALC" if rsi_5m != rsi_15m else "❌ IDENTICAL"
            print(f"{s:12} → Price={price:8.2f} | Change={change:+.3f}% | RSI5m={rsi_5m:5.1f} | RSI15m={rsi_15m:5.1f} {calc}")
    except Exception as e:
        print(f"{s:12} → ERROR: {e}")

print("\n💡 If RSI is MISSING → Backend needs restart")
print("💡 If all RSI=50 → Market is flat (0% change), hybrid calc returns neutral\n")
