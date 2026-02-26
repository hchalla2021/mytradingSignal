#!/usr/bin/env python3
"""
Diagnostic: Check if candlesare being stored in Redis
"""
import requests
import json

BACKEND_URL = "http://localhost:8000"
SYMBOLS = ["NIFTY", "BANKNIFTY", "SENSEX"]

def check_candle_cache():
    """Check endpoint to see Redis candle availability"""
    print("\n" + "="*80)
    print("🔍 Redis Candle Cache Check")
    print("="*80)
    
    for symbol in SYMBOLS:
        try:
            # Try to get some analysis data that shows market status
            url = f"{BACKEND_URL}/api/analysis/analyze/{symbol}"
            response = requests.get(url, timeout=5)
            data = response.json()
            
            indicators = data.get('indicators', {})
            market_status = data.get('status', 'UNKNOWN')
            
            # Check current price (indicates live data)
            price = indicators.get('price', 0)
            ema_20 = indicators.get('ema_20', 0)
            rsi_5m = indicators.get('rsi_5m', 'NOT_FOUND')
            rsi_15m = indicators.get('rsi_15m', 'NOT_FOUND')
            
            print(f"\n📊 {symbol}:")
            print(f"  Market Status: {market_status}")
            print(f"  Price: {price}")
            print(f"  EMA 20: {ema_20}")
            print(f"  RSI 5M: {rsi_5m}")
            print(f"  RSI 15M: {rsi_15m}")
            
            # Diagnose the issue
            if rsi_5m == 'NOT_FOUND' or rsi_15m == 'NOT_FOUND':
                print(f"  ❌ RSI fields MISSING from indicators dict!")
                print(f"     Possible causes:")
                print(f"     1. fetch_dual_rsi_from_cache  is not being called")
                print(f"     2. Or it's returning None/error")
                print(f"     3. Backend code not restarted since changes")
            elif rsi_5m == 50.0 and rsi_15m == 50.0:
                print(f"  ⚠️  RSI values are NEUTRAL (50.0)")
                print(f"     Possible causes:")
                print(f"     1. Not enough candles in Redis ( <30)")
                print(f"     2. WebSocket feed not sending candles properly")
                print(f"     3. Zerodha token expired")
                
                # If EMA 20 is 0, market data isn't flowing
                if ema_20 == 0:
                    print(f"  🚨 CRITICAL: EMA is 0 - NO MARKET DATA FLOWING")
                    print(f"     WebSocket connection may be down")
                elif price > 0:
                    print(f"  ✅ Market data IS flowing (price: {price})")
                    print(f"     Issue is candle aggregation or RSI calculation")
            else:
                print(f"  ✅ RSI values look OK (5m={rsi_5m}, 15m={rsi_15m})")
                
        except requests.exceptions.ConnectionError:
            print(f"❌ Cannot connect to backend at {BACKEND_URL}")
            return
        except Exception as e:
            print(f"❌ Error: {e}")

if __name__ == "__main__":
    print("\nCANDLEDATA & RSI CACHE DIAGNOSTIC")
    check_candle_cache()
    print("\n" + "="*80)
