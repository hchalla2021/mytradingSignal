#!/usr/bin/env python
"""Quick check: Are candles being accumulated? Can API compute OI on them?"""
import sys
import time
import requests
import json

try:
    # Check if ticks are flowing
    print("=== CHECKING OI MOMENTUM DATA FLOW ===\n")
    
    # Test API endpoint
    print("1️⃣ Testing /api/analysis/oi-momentum/{symbol} endpoint:")
    for symbol in ['NIFTY', 'BANKNIFTY', 'SENSEX']:
        try:
            start = time.time()
            resp = requests.get(
                f'http://localhost:8000/api/analysis/oi-momentum/{symbol}',
                timeout=5
            )
            elapsed = time.time() - start
            
            if resp.status_code == 200:
                data = resp.json()
                signal = data.get('final_signal', 'NO_SIGNAL')
                conf = data.get('confidence', 0)
                reasons = data.get('reasons', [])
                print(f"  ✅ {symbol}: {signal} ({conf}%) in {elapsed:.2f}s")
                if reasons:
                    print(f"     → {reasons[0][:70]}")
            else:
                print(f"  ❌ {symbol}: HTTP {resp.status_code}")
                print(f"     {resp.text[:100]}")
        except requests.Timeout:
            print(f"  ⏱️  {symbol}: TIMEOUT (5s) - backend slow")
        except Exception as e:
            print(f"  ❌ {symbol}: {type(e).__name__}: {str(e)[:60]}")
    
    # Check market data in cache
    print("\n2️⃣ Checking market data in cache:")
    try:
        resp = requests.get('http://localhost:8000/api/market/status', timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            print(f"  Market status: {data.get('status', 'UNKNOWN')}")
            for sym in ['NIFTY', 'BANKNIFTY', 'SENSEX']:
                price = data.get(sym, {}).get('price')
                if price:
                    print(f"    • {sym}: ₹{price}")
    except Exception as e:
        print(f"  Couldn't check market status: {e}")
    
    print("\n3️⃣ Checking tick flow:")
    for symbol in ['NIFTY', 'BANKNIFTY', 'SENSEX']:
        try:
            resp = requests.get(f'http://localhost:8000/api/diagnostics/market-feed', timeout=5)
            if resp.status_code == 200:
                data = resp.json()
                if symbol in data.get('symbols_with_data', []):
                    print(f"  ✅ {symbol}: ticks flowing")
                else:
                    print(f"  ⚠️  {symbol}: no ticks in last check")
                break
        except Exception as e:
            print(f"  Couldn't check tick flow: {e}")
            break

except KeyboardInterrupt:
    print("\n⏹️  Interrupted")
except Exception as e:
    print(f"\n❌ Unexpected error: {e}")
    import traceback
    traceback.print_exc()
